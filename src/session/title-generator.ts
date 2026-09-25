import { getProviderManager } from "../api/manager.js";
import type { ChatCompletionChoice, Usage } from "../api/types.js";
import { fileError } from "../util/logger.js";
import {
  clampGeneratedTitle,
  isWeakHeaderTitle,
  TITLE_GEN_MAX_TOKENS,
  TITLE_MAX_LENGTH,
  TITLE_MAX_WORDS,
  TITLE_MIN_WORDS,
} from "../util/title-policy.js";
import type { Message } from "./store.js";
import type { ChatMessage } from "../api/types.js";

const TITLE_SYSTEM_PROMPT =
  `Generate a session title of ${TITLE_MIN_WORDS}-${TITLE_MAX_WORDS} words (max ${TITLE_MAX_LENGTH} characters) that identifies what this conversation is actually about. ` +
  "Be specific — name the subject, file, feature, or problem. " +
  "Never return a generic label like \"Code help\", \"Question\", or \"Discussion\". " +
  "Return ONLY the title text — no quotes, no prefixes, no explanation.";

/** Paired <think>, <thinking>, or <reasoning> tag envelopes. */
const THINKING_TAG_ENVELOPE_RE =
  /<(think|thinking|reasoning)>\s*[\s\S]*?<\/\1>/gi;

/** ```thinking / ```reasoning fenced dumps. */
const THINKING_FENCE_ENVELOPE_RE =
  /```(?:thinking|reasoning)\b[\s\S]*?```/gi;

/** Unclosed thinking fence at start. */
const UNCLOSED_THINKING_FENCE_RE =
  /^\s*```(?:thinking|reasoning)\b[\s\S]*$/i;

/**
 * Markerless "Thinking process:" / "Here's my reasoning process:" preambles.
 * Drop the leading line(s); reject when the remainder is only the preamble.
 */
const LEADING_PROSE_THINKING_PREAMBLE_RE =
  /^[ \t]*(?:(?:here(?:['’]s| is)[ \t]+(?:a|the|my)[ \t]+)|my[ \t]+)?(?:thinking|thought|reasoning)[ \t]+process[ \t]*:?[ \t]*(?:\r?\n)+/i;

const ONLY_PROSE_THINKING_PREAMBLE_RE =
  /^[ \t]*(?:(?:here(?:['’]s| is)[ \t]+(?:a|the|my)[ \t]+)|my[ \t]+)?(?:thinking|thought|reasoning)[ \t]+process[ \t]*:?[ \t]*$/i;

/**
 * Explicit "Title:" / "a good title would be:" markers. Last match wins so a
 * trailing title after unmarked thinking prose is preferred. May appear
 * mid-sentence after meta prose.
 */
const TITLE_MARKER_RE =
  /(?:(?:a\s+)?(?:good\s+)?title(?:\s+would\s+be)?|session\s+title|i(?:['’]ll| will)\s+(?:go\s+with|use))\s*[:\-–—]\s*(.+)$/gi;

/**
 * Leading meta / unmarked-thinking lines that are not the title itself.
 * Applied per line / sentence before salvage.
 */
const META_LINE_RE =
  /^(?:okay|ok|alright|sure)[,!.]?\s*$|^(?:okay|ok|alright|sure)[,!.]?\s+|^(?:the\s+user)\b|^(?:i\s+(?:need|should|will|am|want|think|consider|'m))\b|^(?:let\s+me)\b|^(?:looking\s+at)\b|^(?:based\s+on)\b|^(?:considering)\b|^(?:here(?:['’]s| is))\b|^(?:thinking|thought|reasoning)\b|^(?:a\s+good\s+title)\b/i;

/** Max chars of rejected title text embedded in fileError (JSON-stringified). */
export const TITLE_REJECT_LOG_MAX = 160;

/** OpenCode thinking tag name (literal kept as a plain string). */
const OPENCODE_THINK_TAG = "redacted_thinking";

function stripOpenCodeThinkBlocks(text: string): string {
  const open = "<" + OPENCODE_THINK_TAG + ">";
  const close = "</" + OPENCODE_THINK_TAG + ">";
  let out = text;
  const lowerOpen = open.toLowerCase();
  const lowerClose = close.toLowerCase();

  while (true) {
    const lower = out.toLowerCase();
    const start = lower.indexOf(lowerOpen);
    if (start < 0) break;
    const end = lower.indexOf(lowerClose, start + open.length);
    if (end < 0) {
      // Unclosed dump — drop from the open tag to EOF.
      out = out.slice(0, start);
      break;
    }
    out = out.slice(0, start) + out.slice(end + close.length);
  }

  // Orphan close tag: drop everything through the last close.
  const lower = out.toLowerCase();
  const lastClose = lower.lastIndexOf(lowerClose);
  if (lastClose >= 0) {
    out = out.slice(lastClose + close.length);
  }
  return out;
}

function stripUnclosedThinkingTags(text: string): string {
  return text.replace(
    new RegExp(
      "^\\s*<(?:think|thinking|reasoning|" + OPENCODE_THINK_TAG + ")>[\\s\\S]*$",
      "i"
    ),
    ""
  );
}

function finalizeCleanup(text: string): string {
  return text
    .replace(/^["']|["']$/g, "")
    // Require the colon so "Session title gen fix" is not stripped to "title gen fix".
    .replace(/^(title|session|summary):\s*/i, "")
    .trim();
}

function isStrongTitleCandidate(text: string): boolean {
  const finalized = finalizeCleanup(text);
  if (!finalized) return false;
  const clamped = clampGeneratedTitle(finalized);
  return Boolean(clamped) && !isWeakHeaderTitle(clamped);
}

function pickStrongCandidate(parts: string[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!.trim();
    if (!part) continue;
    if (META_LINE_RE.test(part) && !isStrongTitleCandidate(part)) continue;
    if (isStrongTitleCandidate(part)) return finalizeCleanup(part);
  }
  return null;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractMarkedTitle(text: string): string | null {
  TITLE_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null = TITLE_MARKER_RE.exec(text);
  let last: string | null = null;
  while (match !== null) {
    last = match[1] ?? null;
    match = TITLE_MARKER_RE.exec(text);
  }
  if (!last) return null;
  const finalized = finalizeCleanup(last);
  return isStrongTitleCandidate(finalized) ? finalized : null;
}

/**
 * Strip leaked thinking envelopes / fences / OpenCode blocks and leading
 * thinking-process / meta prose, then salvage a title-like line or sentence
 * when the model dumped unmarked thinking before the real title. Does not
 * clamp — callers run {@link clampGeneratedTitle} next.
 */
export function cleanGeneratedTitleText(raw: string): string {
  let text = stripOpenCodeThinkBlocks(raw);

  // Generic think / thinking / reasoning tag envelopes.
  text = text.replace(THINKING_TAG_ENVELOPE_RE, "");

  // Fenced thinking dumps.
  text = text.replace(THINKING_FENCE_ENVELOPE_RE, "");

  // Unclosed dumps that consumed the whole completion.
  text = stripUnclosedThinkingTags(text);
  text = text.replace(UNCLOSED_THINKING_FENCE_RE, "");

  // Drop leading thinking-process prose; reject preamble-only leftovers.
  text = text.replace(LEADING_PROSE_THINKING_PREAMBLE_RE, "");
  if (ONLY_PROSE_THINKING_PREAMBLE_RE.test(text.trim())) {
    return "";
  }

  const marked = extractMarkedTitle(text);
  if (marked) return marked;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const fromLines = pickStrongCandidate(lines);
  if (fromLines) return fromLines;

  const collapsed = text.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  const fromSentences = pickStrongCandidate(splitSentences(collapsed));
  if (fromSentences) return fromSentences;

  const withoutMeta = lines.filter((l) => !META_LINE_RE.test(l));
  const fromStrippedLines = pickStrongCandidate(withoutMeta);
  if (fromStrippedLines) return fromStrippedLines;

  if (withoutMeta.length > 0) {
    const joined = withoutMeta.join(" ");
    const fromJoined = pickStrongCandidate(splitSentences(joined));
    if (fromJoined) return fromJoined;
    // Leave the last non-meta remnant so weak-reject logs show what survived.
    return finalizeCleanup(withoutMeta[withoutMeta.length - 1]!);
  }

  return finalizeCleanup(collapsed);
}

function formatTitleUsage(usage: Usage | undefined): string {
  if (!usage) return "usage=n/a";
  return `usage=prompt:${usage.prompt_tokens} completion:${usage.completion_tokens} total:${usage.total_tokens}`;
}

/** Truncate + JSON-quote rejected title text for safe file-only logging. */
export function formatRejectedTitleForLog(
  text: string | null | undefined
): string | undefined {
  if (text == null) return undefined;
  const safe = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!safe) return 'rejected=""';
  const clipped =
    safe.length > TITLE_REJECT_LOG_MAX
      ? `${safe.slice(0, TITLE_REJECT_LOG_MAX)}…`
      : safe;
  return `rejected=${JSON.stringify(clipped)}`;
}

/** Pure builder for the title-gen reject fileError message (testable). */
export function formatTitleRejectLogMessage(
  reason: string,
  opts: {
    finishReason?: string | null;
    usage?: Usage;
    rejected?: string | null;
    raw?: string | null;
  } = {}
): string {
  const bits = [
    `finish_reason=${opts.finishReason ?? "n/a"}`,
    formatTitleUsage(opts.usage),
  ];
  const rejected = formatRejectedTitleForLog(opts.rejected);
  if (rejected) bits.push(rejected);
  if (opts.raw != null && opts.raw.trim() && !(opts.rejected && opts.rejected.trim())) {
    const rawSafe = opts.raw
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TITLE_REJECT_LOG_MAX);
    bits.push(`raw=${JSON.stringify(rawSafe)}`);
  }
  return `Session title generation ${reason} (${bits.join("; ")})`;
}

function logEmptyOrWeakTitle(
  reason: string,
  choice: ChatCompletionChoice | undefined,
  usage: Usage | undefined,
  opts: { rejected?: string | null; raw?: string | null } = {}
): void {
  void fileError(
    formatTitleRejectLogMessage(reason, {
      ...(choice?.finish_reason != null
        ? { finishReason: choice.finish_reason }
        : {}),
      ...(usage ? { usage } : {}),
      ...(opts.rejected !== undefined ? { rejected: opts.rejected } : {}),
      ...(opts.raw !== undefined ? { raw: opts.raw } : {}),
    })
  );
}

/**
 * Generate a session title from the first few exchanges of a conversation.
 * Uses the current provider/model to make a lightweight LLM call.
 *
 * Returns the generated title, or null if generation fails.
 */
export async function generateTitle(
  messages: Message[],
  model: string
): Promise<string | null> {
  try {
    const manager = await getProviderManager();

    // Build a minimal conversation from the first few user/assistant exchanges.
    const titleMessages = buildTitleMessages(messages);

    if (titleMessages.length === 0) return null;

    const response = await manager.complete({
      model,
      messages: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        ...titleMessages,
      ],
      max_tokens: TITLE_GEN_MAX_TOKENS,
      temperature: 0.3,
      reasoningLevel: "off",
    });

    const choice = response.choices[0];
    const usage = response.usage;
    const rawContent = choice?.message?.content;
    const text = typeof rawContent === "string" ? rawContent.trim() : "";
    if (!text) {
      logEmptyOrWeakTitle("returned empty content", choice, usage);
      return null;
    }

    const cleaned = cleanGeneratedTitleText(text);
    if (!cleaned) {
      logEmptyOrWeakTitle("empty after thinking cleanup", choice, usage, {
        rejected: "",
        raw: text,
      });
      return null;
    }

    const title = clampGeneratedTitle(cleaned);
    if (!title || isWeakHeaderTitle(title)) {
      logEmptyOrWeakTitle("weak or empty after clamp", choice, usage, {
        rejected: title || cleaned,
      });
      return null;
    }

    return title;
  } catch (error) {
    // Log to file only — stderr is owned by the TUI while a session is open,
    // so console output here corrupts rendered chat output.
    void fileError(
      `Failed to generate session title: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/**
 * Build a condensed conversation for title generation.
 * Takes the first few user-assistant exchanges (up to 4 messages).
 */
/** True when there is enough user/assistant content to generate a title. */
export function hasTitleSource(messages: Message[]): boolean {
  return buildTitleMessages(messages).length > 0;
}

export function buildTitleMessages(messages: Message[]): ChatMessage[] {
  const pairs: ChatMessage[] = [];
  let userMsg: string | null = null;

  for (const msg of messages) {
    if (msg.role === "user" && !userMsg) {
      userMsg = msg.content.slice(0, 200);
    } else if (msg.role === "assistant" && userMsg) {
      pairs.push({ role: "user", content: userMsg });
      pairs.push({ role: "assistant", content: msg.content.slice(0, 200) });
      userMsg = null;

      if (pairs.length >= 4) break;
    }
  }

  // If we have an unanswered user message, include it
  if (userMsg && pairs.length < 4) {
    pairs.push({ role: "user", content: userMsg });
  }

  return pairs;
}
