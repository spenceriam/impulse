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

/**
 * Strip leaked thinking envelopes / fences / OpenCode blocks and leading
 * thinking-process prose, then the existing quote/prefix cleanup. Does not
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

  // Existing wrapping-artifact cleanup.
  return text
    .replace(/^["']|["']$/g, "")
    .replace(/^(title|session|summary):?\s*/i, "")
    .trim();
}

function formatTitleUsage(usage: Usage | undefined): string {
  if (!usage) return "usage=n/a";
  return `usage=prompt:${usage.prompt_tokens} completion:${usage.completion_tokens} total:${usage.total_tokens}`;
}

function logEmptyOrWeakTitle(
  reason: string,
  choice: ChatCompletionChoice | undefined,
  usage: Usage | undefined
): void {
  const finish = choice?.finish_reason ?? "n/a";
  void fileError(
    `Session title generation ${reason} (finish_reason=${finish}; ${formatTitleUsage(usage)})`
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
      logEmptyOrWeakTitle("empty after thinking cleanup", choice, usage);
      return null;
    }

    const title = clampGeneratedTitle(cleaned);
    if (!title || isWeakHeaderTitle(title)) {
      logEmptyOrWeakTitle("weak or empty after clamp", choice, usage);
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
