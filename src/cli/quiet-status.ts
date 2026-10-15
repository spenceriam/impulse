/**
 * Quiet chat density helpers (#153).
 * Templated live status, Worked for commit, event-sourced Recap.
 * No model-authored status; no extra LLM call for Recap.
 */

import path from "path";
import { wrapTextWithAnsi, visibleWidth } from "@mariozechner/pi-tui";

export type QuietToolOutcome = "success" | "failed" | "blocked" | "aborted";

export type QuietInflightTool = {
  id: string;
  name: string;
  arg: string;
  /** Ship-name codename for task (subagent) tools — prefixes the label (#165). */
  codename?: string;
};

export type QuietRecapEvent = {
  name: string;
  arg: string;
  outcome: QuietToolOutcome;
  /**
   * Concrete Recap noun phrase (preferred). Built from tool result metadata
   * at tool-end — never vague filler like "looking at files".
   */
  fact?: string;
};

const QUIET_VERBS: Record<string, string> = {
  file_read: "Reading",
  file_write: "Writing",
  file_edit: "Editing",
  glob: "Finding",
  grep: "Searching",
  ls: "Listing",
  bash: "Running",
  task: "Delegating",
  web_search: "Searching",
  web_fetch: "Fetching",
  todo_write: "Updating todos",
  todo_read: "Reading todos",
  question: "Asking",
  github_issue: "Filing issue",
  plan_revision: "Revising plan",
  install_skill: "Installing skill",
  vision_translate: "Translating",
};

/** Classify tool result for Quiet break-out (Claire: fail/block show real row). */
export function classifyQuietOutcome(result: {
  success: boolean;
  output: string;
}): QuietToolOutcome {
  if (result.success) return "success";
  const output = result.output.toLowerCase();
  if (output.includes("[user decision]") || output.includes("permission denied")) {
    return "blocked";
  }
  if (
    output.includes("aborted") ||
    output.includes("sub-agent aborted") ||
    output.includes("cancelled") ||
    output.includes("canceled")
  ) {
    return "aborted";
  }
  return "failed";
}

export function isQuietBreakOutcome(outcome: QuietToolOutcome): boolean {
  return outcome === "failed" || outcome === "blocked" || outcome === "aborted";
}

/** Short display arg for status line (basename paths, trim noise). */
export function shortQuietArg(name: string, args: Record<string, unknown>): string {
  if (name === "todo_write" || name === "todo_read") {
    return "";
  }
  if (name === "task") {
    const description =
      typeof args["description"] === "string" ? String(args["description"]).trim() : "";
    return truncateArg(description || "subagent");
  }
  if (name === "glob") {
    const pattern = typeof args["pattern"] === "string" ? String(args["pattern"]) : "pattern";
    return truncateArg(pattern);
  }
  if (name === "grep") {
    const pattern = typeof args["pattern"] === "string" ? String(args["pattern"]) : "pattern";
    return truncateArg(pattern);
  }
  if (name === "bash") {
    const command = typeof args["command"] === "string" ? String(args["command"]) : "command";
    return truncateArg(command.replace(/\s+/g, " ").trim());
  }
  if (name === "ls") {
    const p = typeof args["path"] === "string" ? String(args["path"]).trim() : "";
    // Prefer "." over cwd basename mush (e.g. "impulse-pr154") when listing root.
    if (!p || p === "." || p === "./") return ".";
    return truncateArg(shortPath(p));
  }

  const keys = ["path", "filePath", "file", "url", "query", "pattern", "prompt"];
  for (const key of keys) {
    if (typeof args[key] === "string") {
      const raw = String(args[key]).trim();
      if (!raw) continue;
      if (key === "path" || key === "filePath" || key === "file") {
        return truncateArg(shortPath(raw));
      }
      return truncateArg(raw.replace(/\s+/g, " "));
    }
  }
  return "";
}

/**
 * Full-width narration arg — same rules as shortQuietArg but WITHOUT the
 * 40-char cap: the narration line truncates to terminal width at render
 * time, so wide terminals see the whole URL/command.
 */

/** Vague opener verbs that carry no topic of their own. */
const GENERIC_TASK_VERB_RE =
  /^(research|researching|explore|exploring|investigate|investigating|look|looking|check|checking|analy[sz]e|analy[sz]ing|review|reviewing|study|studying|examine|examining|open|opening|read|reading|dig|digging)$/i;

/** Objects that name nothing: "a website page", "the repo", "some files". */
const GENERIC_TASK_OBJECT_RE =
  /^((a|an|the|some|this|that)\s+(website\s+page|webpage|web\s*page|website|site|page|directory|folder|repo|repository|codebase|code|file|files|things?|stuff|project|module)\.?)?$/i;

/** URL / path / quoted phrase / #ref / CamelCase in the object = already concrete. */
const CONCRETE_TASK_TOKEN_RE =
  /(https?:\/\/|~\/|\.?\/|`[^`]+`|"[^"]+"|'[^']+'|#\d+|\b[A-Z][a-z]+[A-Z]\w*)/;

/**
 * A task description is generic when the verb is vague AND the object names
 * nothing ("Researching a website page"). "Research the auth module" is
 * specific and passes through untouched.
 */
function isGenericTaskDescription(description: string): boolean {
  const m = description.match(/^(\S+)\s*(.*)$/);
  if (!m) return false;
  const [, verb, rest] = m;
  if (!GENERIC_TASK_VERB_RE.test(verb!)) return false;
  if (CONCRETE_TASK_TOKEN_RE.test(rest!)) return false;
  return GENERIC_TASK_OBJECT_RE.test(rest!.trim());
}

/** Pull a concrete topic (URL host+path, file path, quoted phrase) from the task prompt. */
function extractTaskTopic(prompt: string): string | null {
  const url = prompt.match(/https?:\/\/[^\s)"']+/);
  if (url) {
    try {
      const u = new URL(url[0]);
      const seg = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(0, 2).join("/");
      return u.hostname + (seg ? `/${seg}` : "");
    } catch {
      /* fall through to path/quoted */
    }
  }
  const pathMatch = prompt.match(/(?:~|\.?\/)[^\s)"']+/);
  if (pathMatch) return shortPath(pathMatch[0]);
  const quoted = prompt.match(/[`"']([^`"']{3,60})[`"']/);
  if (quoted) return quoted[1]!;
  return null;
}

/** Gerund form of the description's leading verb ("Research" → "Researching"). */
function gerundLedWord(word: string): string {
  return /ing$/i.test(word) ? word : gerundOf(word);
}

export function fullQuietArg(name: string, args: Record<string, unknown>): string {
  if (name === "todo_write" || name === "todo_read") return "";
  if (name === "task") {
    const description =
      typeof args["description"] === "string" ? String(args["description"]).trim() : "";
    if (!description) return "subagent";
    // Model-authored descriptions are the last model-text channel in Quiet
    // status. Generic ones ("Researching a website page") get a concrete
    // topic pulled from the task's own prompt — event-sourced (#165).
    if (isGenericTaskDescription(description)) {
      const prompt = typeof args["prompt"] === "string" ? args["prompt"] : "";
      const topic = extractTaskTopic(prompt);
      if (topic) {
        const first = description.split(/\s+/)[0]!;
        return `${gerundLedWord(first)} ${topic}`;
      }
    }
    return description;
  }
  if (name === "glob" || name === "grep") {
    return typeof args["pattern"] === "string" ? String(args["pattern"]).trim() : "pattern";
  }
  if (name === "bash") {
    const command = typeof args["command"] === "string" ? String(args["command"]) : "command";
    return command.replace(/\s+/g, " ").trim();
  }
  if (name === "ls") {
    const p = typeof args["path"] === "string" ? String(args["path"]).trim() : "";
    // "Listing ." reads as nothing — name the thing instead.
    if (!p || p === "." || p === "./") return "the project folder";
    return shortPath(p);
  }
  const keys = ["url", "query", "pattern", "prompt", "filePath", "file", "path"];
  for (const key of keys) {
    if (typeof args[key] === "string") {
      const raw = String(args[key]).trim();
      if (!raw) continue;
      if (key === "path" || key === "filePath" || key === "file") {
        return shortPath(raw);
      }
      return raw.replace(/\s+/g, " ");
    }
  }
  return "";
}

function shortPath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  return base || normalized || ".";
}

function truncateArg(text: string, max = 40): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** True when ls targeted repo root / cwd — use "top-level entries", not folder mush. */
function isLsRootScope(arg: string, metaPath: string): boolean {
  const candidates = [arg, metaPath].map((s) => s.trim()).filter(Boolean);
  if (candidates.length === 0) return true;
  for (const raw of candidates) {
    if (raw === "." || raw === "./" || raw === "") return true;
    try {
      if (path.resolve(raw) === path.resolve(process.cwd())) return true;
    } catch {
      /* ignore */
    }
    // Bare cwd basename (e.g. agent passed folder name as path) → treat as root.
    if (!raw.includes("/") && !raw.includes("\\") && raw === path.basename(process.cwd())) {
      return true;
    }
  }
  // If every candidate looks like root, yes; if any is a real subpath, no.
  return candidates.every((raw) => raw === "." || raw === "./");
}

export function quietToolVerb(name: string): string {
  return QUIET_VERBS[name] ?? `Running ${name}`;
}

/** Fixed thinking phrases for Quiet live line. */
export function quietThinkingPhrase(_kind: "assessing" | "planning"): string {
  // No intent phrase yet → plain "Thinking"; the elapsed tick carries liveness.
  return "Thinking";
}

/**
 * Visible-width truncation for ANSI-free strings (quiet labels are built
 * from plain text). pi-tui's truncateToWidth appends `\x1b[0m` resets and
 * its own "..." — invisible width overhead plus a double ellipsis when we
 * add our `…` — so the fitter walks codepoints itself (wide-char safe).
 */
function truncatePlain(text: string, maxVisible: number): string {
  if (visibleWidth(text) <= maxVisible) return text;
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = visibleWidth(ch);
    if (w + cw > maxVisible) break;
    out += ch;
    w += cw;
  }
  return out;
}

/**
 * Task/subagent activity label: verb-led descriptions gerundize
 * ("Explore quiet-status.ts wiring" → "Exploring quiet-status.ts wiring");
 * non-verb-led descriptions get "Delegating" (unnamed) or pass through
 * capitalized (named helper — the codename already carries agency).
 */
function taskActivityLabel(arg: string, delegatingFallback: boolean): string {
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const firstWord = arg.split(/\s+/)[0] ?? "";
  const lower = firstWord.toLowerCase();
  if (/ing$/i.test(lower)) return cap(arg);
  if (KNOWN_ACTIVITY_VERBS.has(lower)) {
    return `${cap(gerundOf(firstWord))}${arg.slice(firstWord.length)}`;
  }
  return delegatingFallback ? `Delegating ${arg}` : cap(arg);
}

/**
 * Badge chip: bold black on base-16 YELLOW background (`43` — the exact
 * theme color the "impulse" chat header uses via fg(33); follows any
 * theme). Ends by restoring the ghost line's dim+italic, which the reset
 * kills.
 */
export function subagentBadge(codename: string): string {
  return `\x1b[1m\x1b[30m\x1b[43m ${codename} \x1b[0m\x1b[2m\x1b[3m`;
}

/**
 * Main-agent badge for the group narration line — worn ONLY while
 * subagents run alongside main-agent tool calls (#165); plain otherwise.
 */
export function impulseBadge(): string {
  return `\x1b[1m\x1b[30m\x1b[43m impulse \x1b[0m\x1b[2m\x1b[3m`;
}

/** Visible width reserve for a badge + separator (pad + pad + space). */
const BADGE_RESERVE = 3;

/**
 * One named subagent's single live row: badge + objective, a pipe, then the
 * current step with elapsed tick — truncated to width, step side first
 * (#165). Badge padding reserved up front; ANSI substitutes post-fit.
 */
export function formatQuietSubagentLine(
  s: { codename: string; objective: string; label: string; startedAt: number },
  nowMs: number,
  availableWidth: number
): string {
  const suffix = ` (${formatDuration(Math.max(0, nowMs - s.startedAt))})`;
  const fitted = fitQuietLiveLine(
    `${s.codename} ${s.objective} | ${s.label}`,
    suffix,
    availableWidth - 2
  );
  const plainPrefix = `${s.codename} `;
  return fitted.startsWith(plainPrefix)
    ? `${subagentBadge(s.codename)} ${fitted.slice(plainPrefix.length)}`
    : fitted;
}

/** Settled subagent row: badge + objective | Worked for Ns (name stays). */
export function formatQuietSubagentSettle(
  codename: string,
  objective: string,
  elapsedMs: number,
  availableWidth: number
): string {
  // Worked-for rides the suffix slot so narrow widths never clip it.
  const fitted = fitQuietLiveLine(
    `${codename} ${objective} |`,
    ` ${formatWorkedFor(elapsedMs)}`,
    availableWidth - 2
  );
  const plainPrefix = `${codename} `;
  return fitted.startsWith(plainPrefix)
    ? `${subagentBadge(codename)} ${fitted.slice(plainPrefix.length)}`
    : fitted;
}

/** Live state for one named subagent's own two-row narration (#165). */
export type QuietSubagentState = {
  id: string;
  codename: string;
  /** Static assignment (row 1): the task description, humanized. */
  objective: string;
  /** Live current step (row 2): subagent's tool activity, ticking. */
  label: string;
  startedAt: number;
};

/**
 * Humanized Quiet label for one tool call — shared by the live narration
 * line and the subagent sub-step feed (#165). Bash humanizes (never raw
 * shell); gerund-led task args stand alone (no "Delegating Researching…").
 */
export function quietToolLabel(name: string, arg: string): string {
  if (name === "bash") return humanizeBashCommand(arg).live;
  if (name === "task") return taskActivityLabel(arg, true);
  // grep tool: alternation patterns get the same topic treatment as bash
  // grep — "a|b|c" reads as "'a' and 2 more terms", never raw pipes (#165).
  if (name === "grep" && /\\\||\|/.test(arg)) {
    const alts = arg.split(/\\\||\|/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const first = alts[0];
    if (first) {
      const more = alts.length - 1;
      return `Searching the code for '${truncateArg(first, 48)}'${more > 0 ? ` and ${more} more term${more === 1 ? "" : "s"}` : ""}`;
    }
  }
  return arg ? `${quietToolVerb(name)} ${arg}` : quietToolVerb(name);
}

/**
 * Fit a live narration line to the terminal: truncate the LABEL with `…`
 * and always preserve the trailing suffix (` (1 min 24s, 2 failed)`).
 * The suffix is measured per render — it grows on minute rollover and when
 * failures join — so the reserve is never a constant. Extremely narrow
 * widths degrade to suffix-only rather than overflowing (#161).
 */
export function fitQuietLiveLine(
  label: string,
  suffix: string,
  availableWidth: number
): string {
  const avail = Math.max(8, availableWidth);
  if (visibleWidth(`${label}${suffix}`) <= avail) return `${label}${suffix}`;
  const labelBudget = avail - visibleWidth(suffix);
  if (labelBudget >= 8) {
    return `${truncatePlain(label, labelBudget - 1)}…${suffix}`;
  }
  return truncatePlain(suffix.trimStart(), avail);
}

/**
 * Live narration for a Quiet work group.
 * Deliberate plain language — no symbol noise (no ellipses, no glyph marks):
 * "Reading quiet-status.ts (4s, +2 parallel)", "Planning to review the
 * codebase (2s)", "Web fetch https://… (3s, 1 failed)".
 */
export function formatQuietLiveStatus(opts: {
  thinking?: "assessing" | "planning" | null;
  thinkingIntent?: string | null;
  tools: QuietInflightTool[];
  elapsedMs?: number;
  failedCount?: number;
  /** Terminal width the line may span; undefined = no truncation. */
  availableWidth?: number;
}): string {
  const parts: string[] = [];
  if (opts.elapsedMs !== undefined) {
    const tick = formatElapsedTick(opts.elapsedMs);
    if (tick) parts.push(tick);
  }
  if ((opts.failedCount ?? 0) > 0) {
    parts.push(`${opts.failedCount} failed`);
  }
  const fit = (label: string, suffixParts: string[]): string => {
    if (opts.availableWidth === undefined) {
      return suffixParts.length > 0 ? `${label} (${suffixParts.join(", ")})` : label;
    }
    const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";
    return fitQuietLiveLine(label, suffix, opts.availableWidth);
  };
  const running = opts.tools;
  if (running.length > 0) {
    const first = running[0]!;
    const extra = running.length - 1;
    if (extra > 0) parts.splice(1, 0, `+${extra} parallel`);
    // Bash narrates humanized intent; task labels gerundize (quietToolLabel).
    // Named subagents never reach this line — they get their own lines via
    // formatQuietSubagentLine (#165).
    return fit(quietToolLabel(first.name, first.arg), parts);
  }
  if (opts.thinking) {
    let clause = opts.thinkingIntent?.trim() ?? "";
    if (/^how\s+to\s+/i.test(clause)) clause = clause.replace(/^how\s+to\s+/i, "");
    let label: string;
    if (clause) {
      // Verb-led activity label first ("Reviewing the CADcraft codebase…");
      // "Planning to" for approach-thinking; noun-led declarative
      // reasoning reads best as "Understanding …".
      label =
        activityLabelFor(clause) ??
        (KNOWN_CLAUSE_NOUNS.test(clause)
          ? `Understanding ${lowerFirst(clause)}`
          : `Planning to ${lowerFirst(clause)}`);
    } else {
      label = quietThinkingPhrase(opts.thinking);
    }
    return fit(label, parts);
  }
  return fit("Continuing", parts);
}

/**
 * Wall-clock commit line when a Quiet work group settles.
 * <1s → milliseconds; <60s → seconds; 60s+ → "1 min 12s" (never "72s").
 */
export function formatWorkedFor(elapsedMs: number): string {
  const ms = Math.max(0, Math.round(elapsedMs));
  if (ms < 1000) {
    return `Worked for ${ms}ms`;
  }
  return `Worked for ${formatDuration(ms)}`;
}

/** "(4s)" / "(340ms)" tick for live narration; "" when no clock yet.
 *  60s+ rolls into minutes — "1 min 5s", never a bare second count. */
export function formatElapsedTick(elapsedMs?: number): string {
  if (elapsedMs === undefined || elapsedMs < 0) return "";
  return formatDuration(Math.round(elapsedMs));
}

/** Duration in ms → "340ms" | "12s" | "1 min 5s" | "2 min". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds}s`;
}

/**
 * Humanize a fetched URL for the Recap fallback (#173) — same bar as the
 * bash humanizer ("viewed the repo on GitHub"), never URL echo. GitHub
 * paths map to their meaning; other hosts name the site, not the plumbing.
 */
export function humanizeWebFetchTarget(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const segs = u.pathname.split("/").filter(Boolean);

    if (host === "github.com" || host.endsWith(".github.com")) {
      const [owner, repo, kind, num] = segs;
      if (owner && repo) {
        if (kind === "issues" && num && /^\d+$/.test(num)) {
          return `read issue #${num} on GitHub`;
        }
        if ((kind === "pull" || kind === "p") && num && /^\d+$/.test(num)) {
          return `read PR #${num} on GitHub`;
        }
        if (kind === "issues") return "checked issues on GitHub";
        if (kind === "releases" || kind === "tags") return "checked releases on GitHub";
        if (/^readme/i.test(kind ?? "")) return "read the README on GitHub";
        if (kind === "tree" || kind === "blob" || kind === undefined || kind === "") {
          return `viewed ${owner}/${repo.replace(/\.git$/, "")} on GitHub`;
        }
        return `viewed ${owner}/${repo.replace(/\.git$/, "")} on GitHub`;
      }
      return "read a page on GitHub";
    }

    return `read a page from ${host}`;
  } catch {
    return null;
  }
}

/** Past-tense plain-language verbs for done→next Recap facts. */
const QUIET_OUTCOME_VERBS: Record<string, string> = {
  file_read: "reviewed",
  file_write: "created",
  file_edit: "updated",
  glob: "found",
  grep: "searched",
  ls: "looked through",
  bash: "ran",
  task: "delegated",
  web_search: "searched the web for",
  web_fetch: "fetched",
  todo_write: "updated todos",
  todo_read: "reviewed todos",
  question: "asked",
  github_issue: "filed an issue",
  plan_revision: "updated the plan",
  install_skill: "installed skill",
  vision_translate: "translated",
};

/**
 * Humanized bash command for Quiet narration — verb + topic, never raw
 * shell (#164). Chains are decomposed (&&, ||, ;, |), scaffolding segments
 * (cd/sleep/echo/redirects/head/tail) dropped, and the first meaningful
 * segment classified. `live` feeds the narration line, `done` feeds Recap
 * facts (#163) — one classifier, two tenses. Unmapped commands fall back
 * to the bare binary name ("Running terraform"); raw args never render in
 * Quiet (Verbose keeps them).
 */
export type HumanizedCommand = {
  /** Live narration form: "Searching the code for 'quiet-status'". */
  live: string;
  /** Recap fact form: "searched the code for 'quiet-status'". */
  done: string;
};

function hc(live: string, done: string): HumanizedCommand {
  return { live, done };
}

/** Split a shell chain into segments; strip redirects and noise operators. */
function splitShellChain(command: string): string[] {
  return command
    .replace(/\d*>&\d+/g, " ") // 2>&1
    .replace(/\d*>>?\s*\S+/g, " ") // > file, 2>/dev/null, >> log
    .split(/&&|\|\||;|(?<!\\)\|/) // &&, ||, ;, and unescaped |
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/** Segments that set the stage rather than carry intent. */
const SHELL_SCAFFOLDING_RE =
  /^(cd|sleep|echo|printf|export|set|unset|true|false|clear|wait|time|read|head|tail|xargs|env)\b/i;

/** First non-scaffolding segment's tokens (env prefixes and sudo skipped). */
function meaningfulTokens(command: string): string[] | null {
  for (const seg of splitShellChain(command)) {
    if (SHELL_SCAFFOLDING_RE.test(seg)) continue;
    const tokens = seg.split(/\s+/);
    while (
      tokens.length > 0 &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]!) || tokens[0] === "sudo")
    ) {
      tokens.shift();
    }
    if (tokens.length > 0) return tokens;
  }
  return null;
}

/** First flag-free token after `skip` leading tokens. */
function firstOperand(tokens: string[], skip: number): string | null {
  for (let i = skip; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith("-")) return t;
  }
  return null;
}

/** Extract a search pattern: quoted string wins; count `\|` alternations. */
function extractSearchPattern(tokens: string[]): { term: string; more: number } | null {
  const quoted = tokens.join(" ").match(/["']([^"']+)["']/);
  let pattern = quoted?.[1] ?? firstOperand(tokens, 1);
  if (!pattern) return null;
  const more = (pattern.match(/\\\|/g) ?? []).length;
  const term = pattern.split(/\\\||\|/)[0]!.trim();
  if (!term) return null;
  return { term: truncateArg(term, 48), more };
}

function hostnameOf(token: string | null): string | null {
  if (!token) return null;
  try {
    return new URL(token).hostname;
  } catch {
    const m = token.match(/^(?:https?:\/\/)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    return m?.[1] ?? null;
  }
}

function basenameOf(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() ?? p;
}

const TEST_RUNNERS_RE =
  /^(npm|bun|yarn|pnpm)\s+test$|^(go\s+test|cargo\s+test|pytest|jest|vitest)$/;

function classifyBashSegment(tokens: string[]): HumanizedCommand {
  const bin = basenameOf(tokens[0]!);
  const sub = tokens[1] ?? "";
  const rest = tokens.join(" ").toLowerCase();

  // git family
  if (bin === "git") {
    if (/^(log|show|reflog)$/.test(sub)) return hc("Reviewing recent commits", "reviewed recent changes");
    if (sub === "diff") return hc("Reviewing the current changes", "reviewed the current changes");
    if (sub === "status") return hc("Checking what changed in the repo", "checked what changed in the repo");
    if (sub === "commit") return hc("Making a commit", "made a commit");
    if (sub === "push") return hc("Pushing commits", "pushed commits");
    if (/^(pull|fetch)$/.test(sub)) return hc("Pulling the latest changes", "pulled the latest changes");
    if (/^(branch|tag)$/.test(sub)) return hc("Checking the repo branches", "checked the repo branches");
    if (/^(checkout|switch)$/.test(sub)) return hc("Switching branches", "switched branches");
    if (sub === "clone") {
      const url = firstOperand(tokens, 2);
      const name = url ? basenameOf(url).replace(/\.git$/, "") : null;
      return name ? hc(`Cloning ${name}`, `cloned ${name}`) : hc("Cloning a repo", "cloned a repo");
    }
    return hc("Working with git", "worked with git");
  }

  // gh (GitHub CLI) family
  if (bin === "gh") {
    if (sub === "repo") return hc("Viewing the repo on GitHub", "viewed the repo on GitHub");
    if (sub === "release") {
      const tag = tokens[2] === "view" ? firstOperand(tokens, 3) : null;
      return tag
        ? hc(`Checking release ${tag} on GitHub`, `checked release ${tag} on GitHub`)
        : hc("Checking releases on GitHub", "checked releases on GitHub");
    }
    if (sub === "pr") {
      const num = tokens.find((t) => /^#?\d+$/.test(t));
      return num
        ? hc(`Checking PR #${num.replace("#", "")} on GitHub`, `checked PR #${num.replace("#", "")} on GitHub`)
        : hc("Checking pull requests on GitHub", "checked pull requests on GitHub");
    }
    if (sub === "issue") {
      const num = tokens.find((t) => /^#?\d+$/.test(t));
      return num
        ? hc(`Checking issue #${num.replace("#", "")} on GitHub`, `checked issue #${num.replace("#", "")} on GitHub`)
        : hc("Checking issues on GitHub", "checked issues on GitHub");
    }
    if (sub === "api") {
      return /\/readme\b/.test(rest)
        ? hc("Reading the README on GitHub", "read the README on GitHub")
        : hc("Querying the GitHub API", "queried the GitHub API");
    }
    if (sub === "search") return hc("Searching GitHub", "searched GitHub");
    return hc("Working with GitHub", "worked with GitHub");
  }

  // test runners / package managers
  if (TEST_RUNNERS_RE.test(rest)) return hc("Running the tests", "ran the tests");
  if (/^(npm|bun|yarn|pnpm)$/.test(bin) && /^(install|add|i)$/.test(sub)) {
    const pkg = firstOperand(tokens, 2);
    return pkg
      ? hc(`Installing ${pkg}`, `installed ${pkg}`)
      : hc("Installing dependencies", "installed dependencies");
  }
  if (/^(npm|bun|yarn|pnpm)$/.test(bin) && sub === "run") {
    const script = firstOperand(tokens, 2);
    return script ? hc(`Running ${script}`, `ran ${script}`) : hc("Running a script", "ran a script");
  }

  // search / read / fetch
  if (/^(grep|rg|ag|ack|fd)$/.test(bin)) {
    const pat = extractSearchPattern(tokens);
    if (pat) {
      const topic = `'${pat.term}'${pat.more > 0 ? ` and ${pat.more} more term${pat.more === 1 ? "" : "s"}` : ""}`;
      return hc(`Searching the code for ${topic}`, `searched the code for ${topic}`);
    }
    return hc("Searching the code", "searched the codebase");
  }
  if (/^(ls|find|tree|du|df)$/.test(bin)) return hc("Checking the folder contents", "checked the folder contents");
  if (/^(cat|less|more|sed|awk)$/.test(bin)) {
    const file = firstOperand(tokens, 1);
    const name = file && !file.startsWith("'") ? basenameOf(file) : null;
    return name
      ? hc(`Looking at ${name}`, `looked at ${name}`)
      : hc("Looking at a file", "looked at a file");
  }
  if (/^(curl|wget)$/.test(bin)) {
    const host = hostnameOf(tokens.find((t) => /^https?:\/\//.test(t)) ?? null);
    return host
      ? hc(`Fetching a page from ${host}`, `fetched a page from ${host}`)
      : hc("Fetching a web page", "fetched a web page");
  }
  if (/^(mkdir|touch|ln)$/.test(bin)) return hc("Setting up files", "set up files");
  if (/^(rm|mv|cp|rsync)$/.test(bin)) return hc("Reorganizing files", "reorganized files");

  // script runners: npx rea-agents … → "Running rea-agents"
  if (/^(npx|bunx)$/.test(bin)) {
    const pkg = firstOperand(tokens, 1);
    return pkg ? hc(`Running ${basenameOf(pkg)}`, `ran ${basenameOf(pkg)}`) : hc("Running a package", "ran a package");
  }
  if (/^(node|python|python3|bun|deno|ts-node)$/.test(bin)) {
    const script = firstOperand(tokens, 1);
    return script
      ? hc(`Running ${basenameOf(script)}`, `ran ${basenameOf(script)}`)
      : hc(`Running ${bin}`, `ran ${bin}`);
  }

  // Default: bare binary name, never args.
  return hc(`Running ${bin}`, `ran ${bin}`);
}

/**
 * Humanize a shell command for Quiet narration. Chains collapse to their
 * first meaningful segment; all-scaffolding chains get the generic.
 */
export function humanizeBashCommand(command: string): HumanizedCommand {
  const tokens = meaningfulTokens(command);
  if (!tokens) return hc("Running a terminal command", "ran a terminal command");
  return classifyBashSegment(tokens);
}

/** Ban list — never emit these as Recap nouns (ambiguous / filler). */
const VAGUE_RECAP_ARGS = new Set([
  "",
  ".",
  "..",
  "command",
  "pattern",
  "subagent",
  "files",
  "file",
  "repo",
  "the repo",
  "things",
  "stuff",
]);

const VAGUE_RECAP_PHRASES = [
  /^looking at\b/i,
  /^working on\b/i,
  /^listing things\b/i,
  /^reading files\b/i,
  /^exploring\b/i,
];

export function quietOutcomeVerb(name: string): string {
  return QUIET_OUTCOME_VERBS[name] ?? name.replace(/_/g, " ");
}

/** True when an arg/fact is too mushy for Recap. */
export function isVagueRecapNoun(text: string | null | undefined): boolean {
  if (text == null) return true;
  const t = text.trim();
  if (!t) return true;
  if (VAGUE_RECAP_ARGS.has(t.toLowerCase())) return true;
  if (VAGUE_RECAP_PHRASES.some((re) => re.test(t))) return true;
  return false;
}

/**
 * Build one concrete Recap fact from a completed tool.
 * Prefers result metadata (counts, paths, exit) over bare args.
 * Returns null when nothing specific can be said (caller skips the event).
 */
export function buildQuietRecapFact(
  name: string,
  arg: string,
  result: {
    success: boolean;
    output: string;
    metadata?: Record<string, unknown>;
  }
): string | null {
  const meta = result.metadata ?? {};
  const outcome = classifyQuietOutcome(result);
  const statusSuffix =
    outcome === "failed" || outcome === "blocked" || outcome === "aborted"
      ? ` ${outcome}`
      : "";

  switch (name) {
    case "ls": {
      const total =
        typeof meta["totalEntries"] === "number" ? meta["totalEntries"] : null;
      const shown =
        typeof meta["entryCount"] === "number" ? meta["entryCount"] : null;
      const truncated = meta["truncated"] === true;
      if (total === null) return null;
      const n = truncated && shown !== null ? shown : total;
      const metaPath =
        typeof meta["path"] === "string" ? meta["path"].trim() : "";
      const scope = isLsRootScope(arg, metaPath)
        ? "the project folder"
        : truncateArg(arg || shortPath(metaPath), 28);
      if (truncated && shown !== null && shown < total) {
        return `looked through ${scope} (${shown} of ${total} items)`;
      }
      return `looked through ${scope} (${n} items)`;
    }
    case "glob": {
      const n =
        typeof meta["matchCount"] === "number"
          ? meta["matchCount"]
          : typeof meta["totalMatches"] === "number"
            ? meta["totalMatches"]
            : null;
      const pattern =
        (typeof meta["pattern"] === "string" && meta["pattern"]) ||
        (!isVagueRecapNoun(arg) ? arg : "");
      if (n === null) {
        return pattern ? `searched for files matching ${truncateArg(pattern, 28)}` : null;
      }
      if (n === 0) return pattern ? `found no files matching ${truncateArg(pattern, 28)}` : null;
      if (pattern) {
        return `found ${n} files matching ${truncateArg(pattern, 24)}`;
      }
      return `found ${n} files`;
    }
    case "grep": {
      const n = typeof meta["matchCount"] === "number" ? meta["matchCount"] : null;
      const pattern =
        (typeof meta["pattern"] === "string" && meta["pattern"]) ||
        (!isVagueRecapNoun(arg) ? arg : "");
      if (!pattern) return null;
      const p = truncateArg(pattern, 28);
      if (n === null) return `searched for ${p}${statusSuffix}`;
      if (n === 0) return `found no matches for ${p}`;
      return `found ${n} match${n === 1 ? "" : "es"} for ${p}`;
    }
    case "file_read": {
      if (isVagueRecapNoun(arg)) return null;
      return `reviewed ${arg}`;
    }
    case "file_edit": {
      if (isVagueRecapNoun(arg)) return null;
      return `updated ${arg}${statusSuffix}`;
    }
    case "file_write": {
      if (isVagueRecapNoun(arg)) return null;
      return `created ${arg}${statusSuffix}`;
    }
    case "bash": {
      const cmd =
        (typeof meta["command"] === "string" && meta["command"].trim()) ||
        arg;
      // Humanized past tense, never raw command echo (#163/#164).
      return `${humanizeBashCommand(cmd).done}${statusSuffix}`;
    }
    case "web_search": {
      if (isVagueRecapNoun(arg)) return null;
      return `searched the web for ${truncateArg(arg, 32)}`;
    }
    case "web_fetch": {
      // Humanized, never URL echo — "viewed owner/repo on GitHub" (#173).
      const phrase = humanizeWebFetchTarget(arg);
      return phrase ?? null;
    }
    case "task": {
      if (isVagueRecapNoun(arg) || arg === "subagent") return null;
      // Named subagents read as people, not jargon: "subagent Saratoga: …" (#165)
      const codename =
        typeof meta["codename"] === "string" ? meta["codename"].trim() : "";
      if (codename) {
        return `subagent ${codename}: ${lowerFirst(truncateArg(arg, 48))}${statusSuffix}`;
      }
      return `delegated ${truncateArg(arg, 36)}${statusSuffix}`;
    }
    case "question": {
      if (outcome === "failed" || outcome === "blocked" || outcome === "aborted") {
        const topic = !isVagueRecapNoun(arg) ? arg : "question";
        return `asked a question (${truncateArg(topic, 32)}) — unanswered`;
      }
      if (!isVagueRecapNoun(arg)) return `asked a question (${truncateArg(arg, 32)})`;
      return null;
    }
    case "todo_write":
    case "todo_read":
      // Todos feed Next; skip as Recap mush unless we have nothing else.
      return null;
    case "github_issue": {
      if (isVagueRecapNoun(arg)) return `filed an issue${statusSuffix}`;
      return `filed an issue (${truncateArg(arg, 32)})${statusSuffix}`;
    }
    case "plan_revision":
      return "updated the plan";
    case "install_skill": {
      if (isVagueRecapNoun(arg)) return null;
      return `installed the ${truncateArg(arg, 28)} skill`;
    }
    default: {
      if (!isVagueRecapNoun(arg)) return `handled ${truncateArg(arg, 36)}${statusSuffix}`;
      return null;
    }
  }
}

/** Optional Next signals — omit `· Next:` when none are available (never invent). */
export type QuietRecapNextHints = {
  /** in_progress or first pending todo content */
  pendingTodo?: string | null;
  /** Short label from last failed/blocked tool */
  lastFailure?: string | null;
  /** Cancelled/unanswered question topic */
  unansweredAsk?: string | null;
  /** First open unchecked plan task */
  openPlanItem?: string | null;
};

/**
 * Pick one concrete Next clause only when open work remains.
 * Priority: pending todo → last failure → unanswered ask → open plan.
 * Returns null when the turn left nothing open (caller omits `· Next:`).
 */
export function pickQuietRecapNext(hints: QuietRecapNextHints = {}): string | null {
  const todo = hints.pendingTodo?.trim();
  if (todo && !isVagueRecapNoun(todo)) return truncateArg(todo, 48);
  const fail = hints.lastFailure?.trim();
  if (fail && !isVagueRecapNoun(fail)) return truncateArg(fail, 48);
  const ask = hints.unansweredAsk?.trim();
  if (ask && !isVagueRecapNoun(ask)) return truncateArg(ask, 48);
  const plan = hints.openPlanItem?.trim();
  if (plan && !isVagueRecapNoun(plan)) return truncateArg(plan, 48);
  return null;
}

/** First unchecked markdown task `- [ ] …` from plan tasks.md, or null. */
export function extractOpenPlanItem(tasksMarkdown: string | null | undefined): string | null {
  if (!tasksMarkdown) return null;
  const match = tasksMarkdown.match(/^\s*[-*]\s+\[\s\]\s+(.+)$/m);
  const item = match?.[1]?.trim();
  return item && !isVagueRecapNoun(item) ? item : null;
}

/** Build last-failure Next label from events (most recent failed/blocked). */
export function lastFailureNextLabel(events: QuietRecapEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.outcome !== "failed" && ev.outcome !== "blocked") continue;
    // Prefer concrete retry target from fact/arg; bash args humanize so the
    // Next line never echoes a raw command (#163).
    if (ev.arg && !isVagueRecapNoun(ev.arg)) {
      return ev.name === "bash"
        ? `retry ${lowerFirst(humanizeBashCommand(ev.arg).live)}`
        : `retry ${truncateArg(ev.arg, 40)}`;
    }
    if (ev.fact) {
      const m = ev.fact.match(/^ran (.+?)(?: failed| blocked| aborted)?$/);
      if (m?.[1]) return `retry ${m[1]}`;
    }
    return `retry ${quietOutcomeVerb(ev.name)}`;
  }
  return null;
}

/** Unanswered ask Next from cancelled/failed question tools. */
export function unansweredAskNextLabel(events: QuietRecapEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.name !== "question") continue;
    if (ev.outcome !== "failed" && ev.outcome !== "blocked" && ev.outcome !== "aborted") {
      continue;
    }
    if (ev.arg && !isVagueRecapNoun(ev.arg)) return `answer ${truncateArg(ev.arg, 40)}`;
    return "answer open question";
  }
  return null;
}

/** Resolve a concrete fact string for one event, or null if mush. */
function resolveRecapFact(ev: QuietRecapEvent): string | null {
  const pre = ev.fact?.trim();
  if (pre && !isVagueRecapNoun(pre)) return pre;

  if (ev.outcome === "success") {
    if (ev.arg && !isVagueRecapNoun(ev.arg)) {
      return `${quietOutcomeVerb(ev.name)} ${ev.arg}`;
    }
    return null;
  }

  const status = ev.outcome;
  if (ev.arg && !isVagueRecapNoun(ev.arg)) {
    return `${quietOutcomeVerb(ev.name)} ${ev.arg} ${status}`;
  }
  return `${quietOutcomeVerb(ev.name)} ${status}`;
}

/**
 * Coalesce multiple successful file_read/edit/write of distinct paths into one fact.
 * e.g. read AGENTS.md, quiet-status.ts
 */
function coalesceFileFacts(events: QuietRecapEvent[]): {
  facts: string[];
  consumed: Set<number>;
} {
  const consumed = new Set<number>();
  const facts: string[] = [];
  const groups: Array<"file_read" | "file_edit" | "file_write"> = [
    "file_read",
    "file_edit",
    "file_write",
  ];

  for (const name of groups) {
    const idxs: number[] = [];
    const files: string[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.name !== name || ev.outcome !== "success") continue;
      if (!ev.arg || isVagueRecapNoun(ev.arg)) continue;
      if (files.includes(ev.arg)) {
        consumed.add(i);
        continue;
      }
      idxs.push(i);
      files.push(ev.arg);
    }
    if (files.length === 0) continue;
    if (files.length === 1) continue; // leave as single event fact
    const verb = quietOutcomeVerb(name);
    const shown = files.slice(0, 3);
    const extra = files.length - shown.length;
    const noun =
      extra > 0 ? `${shown.join(", ")} (+${extra} more)` : shown.join(", ");
    facts.push(`${verb} ${noun}`);
    for (const i of idxs) consumed.add(i);
  }

  return { facts, consumed };
}

/**
 * Event-sourced done→next Recap.
 * Shape: `Recap: read AGENTS.md; listed 27 top-level entries · Next: token-refresh test`
 * Concrete facts only; omits `· Next:` when no open work. Never invents. No LLM.
 */
export function formatQuietRecap(
  events: QuietRecapEvent[],
  nextHints: QuietRecapNextHints = {}
): string | null {
  if (events.length === 0) return null;

  const { facts: coalesced, consumed } = coalesceFileFacts(events);
  const parts: string[] = [...coalesced];
  const seen = new Set(parts.map((p) => p.toLowerCase()));
  let anySuccess = false;
  const failed = events.filter((e) => e.outcome === "failed" || e.outcome === "blocked");

  for (let i = 0; i < events.length; i++) {
    if (consumed.has(i)) continue;
    const ev = events[i]!;
    if (ev.outcome === "success") anySuccess = true;
    // Failures appended after successes so pass/fail stays clear
    if (ev.outcome === "failed" || ev.outcome === "blocked") continue;

    const fact = resolveRecapFact(ev);
    if (!fact) continue;
    const key = fact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(fact);
  }

  // Append most recent failure as a concrete status fact
  if (failed.length > 0) {
    anySuccess = events.some((e) => e.outcome === "success") || anySuccess;
    const f = failed[failed.length - 1]!;
    const failFact = resolveRecapFact(f);
    if (failFact) {
      const key = failFact.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(failFact);
      }
    }
  }

  if (parts.length === 0) return null;

  // Cap to 5 concrete facts (fills up to 3 wrapped lines); keep last failure if capped
  let capped = parts.slice(0, 5);
  if (parts.length > 5 && failed.length > 0) {
    const lastFail = resolveRecapFact(failed[failed.length - 1]!);
    if (lastFail && !capped.some((p) => p.toLowerCase() === lastFail.toLowerCase())) {
      capped = [...capped.slice(0, 4), lastFail];
    }
  }

  // Facts are sentences; no trailing symbols — the owner never asked for a
  // success checkmark and rejected it (#173 dogfood).
  const done = capped.join("; ");

  const lastFailure =
    nextHints.lastFailure !== undefined
      ? nextHints.lastFailure
      : lastFailureNextLabel(events);
  const unansweredAsk =
    nextHints.unansweredAsk !== undefined
      ? nextHints.unansweredAsk
      : unansweredAskNextLabel(events);

  const next = pickQuietRecapNext({
    pendingTodo: nextHints.pendingTodo ?? null,
    lastFailure: lastFailure ?? null,
    unansweredAsk: unansweredAsk ?? null,
    openPlanItem: nextHints.openPlanItem ?? null,
  });

  if (next) {
    return `Recap: ${done} · Next: ${next}`;
  }
  return `Recap: ${done}`;
}

/**
 * Wrap Recap to at most `maxLines` rows; ellipsize the last line if truncated.
 */
/**
 * Wrap a Recap at the chat inner width. Full wrap, never ellipsize (#168):
 * cutting a sentence mid-word defeats the Recap. Content length is governed
 * by the ≤40-word model instruction and the ≤5-fact fallback rule, not by a
 * hard visual cap.
 */
export function wrapQuietRecapLines(
  recapLine: string,
  width: number
): string[] {
  const avail = Math.max(8, width);
  // Model-authored recaps may carry hard newlines; the Recap is one flowing
  // paragraph, so collapse them — otherwise the wrapper strands fragments
  // ("and the" alone on a row).
  const flat = recapLine.replace(/\s*\n\s*/g, " ");
  return wrapTextWithAnsi(flat, avail);
}

export type QuietSettleResult = {
  workedForLine: string;
  /** Wall-clock ms of the group. */
  elapsedMs: number;
  /** Distinct tools that ran in the group (0 for thinking-only groups). */
  toolCount: number;
};

/**
 * Tracks one contiguous Quiet work group and guarantees a single settle commit.
 * Settle only at AI-stream / turn-end boundaries — not when tools empty —
 * so post-tool thinking stays in the same group (no duplicate Worked for).
 */
export class QuietWorkGroupTracker {
  private group: {
    startedAt: number;
    thinking: "assessing" | "planning" | null;
    thinkingIntent: string | null;
    thinkingIntentFromMarker: boolean;
    thinkingBuffer: string;
    tools: QuietInflightTool[];
    toolCount: number;
    failedCount: number;
    /** task (subagent) tools seen this group — settle credits "(N helpers)". */
    helperCount: number;
    lastLabel: string | null;
    hadActivity: boolean;
    hadTools: boolean;
    settled: boolean;
  } | null = null;
  private groupsSettled = 0;
  /** After AI prose, next Worked for should be preceded by a blank row. */
  private gapBeforeNextWorkedFor = false;

  reset(): void {
    this.group = null;
    this.groupsSettled = 0;
    this.gapBeforeNextWorkedFor = false;
    this.subagents.clear();
  }

  get settledCount(): number {
    return this.groupsSettled;
  }

  get active(): boolean {
    return this.group !== null && !this.group.settled;
  }

  get thinking(): "assessing" | "planning" | null {
    return this.group?.thinking ?? null;
  }

  get thinkingIntent(): string | null {
    return this.group?.thinkingIntent ?? null;
  }

  get tools(): QuietInflightTool[] {
    return this.group?.tools ?? [];
  }

  get toolCount(): number {
    return this.group?.toolCount ?? 0;
  }

  /** Wall-clock ms the current (or last) group has been running. */
  elapsedMs(nowMs: number = Date.now()): number {
    if (!this.group) return 0;
    return Math.max(0, nowMs - this.group.startedAt);
  }

  get hadActivity(): boolean {
    return this.group?.hadActivity ?? false;
  }

  get needsGapBeforeWorkedFor(): boolean {
    return this.gapBeforeNextWorkedFor;
  }

  /** Call when AI streaming content was finalized before a tool/thinking phase. */
  markGapBeforeNextWorkedFor(): void {
    this.gapBeforeNextWorkedFor = true;
  }

  consumeGapBeforeWorkedFor(): boolean {
    if (!this.gapBeforeNextWorkedFor) return false;
    this.gapBeforeNextWorkedFor = false;
    return true;
  }

  ensure(nowMs: number = Date.now()): void {
    if (this.group && !this.group.settled) return;
    this.group = {
      startedAt: nowMs,
      thinking: null,
      thinkingIntent: null,
      thinkingIntentFromMarker: false,
      thinkingBuffer: "",
      tools: [],
      toolCount: 0,
      failedCount: 0,
      helperCount: 0,
      lastLabel: null,
      hadActivity: false,
      hadTools: false,
      settled: false,
    };
  }

  /**
   * Feed the live reasoning stream so the narration can show WHAT is being
   * planned. Models that think via reasoning_content never emit the
   * <intent> content marker during thinking, so until the stream is long
   * enough the first words of the reasoning become the intent; once it is,
   * the narration shows a continuously-updating tail of the thinking itself
   * (streaming display, like MiniMax Code). An explicit <intent> marker
   * always overrides the derivation.
   */
  noteThinkingText(text: string): void {
    if (!this.group || this.group.settled) return;
    this.group.thinkingBuffer = (this.group.thinkingBuffer + text).slice(-400);
    if (this.group.thinkingIntent || this.group.thinkingIntentFromMarker) return;
    const derived = deriveIntentFromThinking(this.group.thinkingBuffer);
    if (derived) {
      this.group.thinkingIntent = derived;
    }
  }

  /** A tool in this group failed/blocked/was aborted — narrated as ✗. */
  noteFailed(): void {
    if (!this.group || this.group.settled) return;
    this.group.failedCount += 1;
  }

  get failedCount(): number {
    return this.group?.failedCount ?? 0;
  }

  setThinking(kind: "assessing" | "planning", nowMs: number = Date.now()): void {
    this.ensure(nowMs);
    const g = this.group!;
    if (!g.thinking) {
      g.thinking =
        this.groupsSettled > 0 || g.hadTools || g.tools.length > 0
          ? "planning"
          : kind;
    }
    g.hadActivity = true;
  }

  /** Model-emitted intent phrase for the narration line ("review the codebase"). */
  setThinkingIntent(intent: string): void {
    if (!this.group || this.group.settled) return;
    const trimmed = intent.trim();
    if (!trimmed) return;
    // An explicit <intent> marker always beats the reasoning-derived guess.
    this.group.thinkingIntent = trimmed.slice(0, 60);
    this.group.thinkingIntentFromMarker = true;
    if (!this.group.thinking) {
      this.group.thinking =
        this.groupsSettled > 0 || this.group.hadTools ? "planning" : "assessing";
    }
    this.group.hadActivity = true;
  }

  addTool(tool: QuietInflightTool, nowMs: number = Date.now()): void {
    this.ensure(nowMs);
    const g = this.group!;
    g.thinking = null;
    g.thinkingIntent = null;
    g.hadActivity = true;
    g.hadTools = true;
    // Same-id re-dispatch (permission approval flow) updates in place —
    // never double-counts.
    const existing = g.tools.find((t) => t.id === tool.id);
    if (existing) {
      existing.arg = tool.arg;
      return;
    }
    g.toolCount += 1;
    if (tool.name === "task") g.helperCount += 1;
    g.tools.push(tool);
  }

  removeTool(id: string): void {
    if (!this.group) return;
    this.group.tools = this.group.tools.filter((t) => t.id !== id);
  }

  findToolArg(id: string): string | undefined {
    return this.group?.tools.find((t) => t.id === id)?.arg;
  }

  // ?? Named subagent lines (#165) ??????????????????????????????????????????

  /** One line per running subagent — flat, never nested. */
  private subagents = new Map<string, QuietSubagentState>();

  /**
   * A named subagent (task tool + codename) starts its OWN two-row
   * narration: static objective row + indented live step row (#165).
   * The task call still counts toward the group's tool/subagent tallies,
   * but never appears in the group narration itself.
   */
  addSubagent(id: string, codename: string, objective: string, nowMs: number = Date.now()): void {
    this.ensure(nowMs);
    const g = this.group!;
    g.thinking = null;
    g.thinkingIntent = null;
    g.hadActivity = true;
    g.hadTools = true;
    const existing = this.subagents.get(id);
    if (existing) {
      // Same-id re-dispatch (permission approval flow) updates in place.
      existing.objective = objective;
      return;
    }
    g.toolCount += 1;
    g.helperCount += 1;
    // "Working…" until the first progress event names the current step.
    this.subagents.set(id, { id, codename, objective, label: "Working…", startedAt: nowMs });
  }

  getSubagent(id: string): QuietSubagentState | undefined {
    return this.subagents.get(id);
  }

  listSubagents(): QuietSubagentState[] {
    return [...this.subagents.values()];
  }

  /** The subagent's current step (fed by the progress events). */
  updateSubagentLabel(id: string, label: string): void {
    const s = this.subagents.get(id);
    if (s) s.label = label;
  }

  /** Subagent finished → wall-clock ms for its own Worked-for harden. */
  settleSubagent(id: string, nowMs: number = Date.now()): number | null {
    const s = this.subagents.get(id);
    if (!s) return null;
    this.subagents.delete(id);
    return Math.max(0, nowMs - s.startedAt);
  }

  /** Subagent failed/blocked/aborted → drop the live line (the real tool row shows detail). */
  dropSubagent(id: string): void {
    this.subagents.delete(id);
  }

  /**
   * Swap a running tool's label arg — legacy shim kept for callers from the
   * pre-subagent-line feed; subagent steps now use updateSubagentLabel.
   */
  updateToolArg(id: string, arg: string): void {
    const t = this.group?.tools.find((t) => t.id === id);
    if (t) t.arg = arg;
  }

  /**
   * Null when the group's only live work is subagents — their own lines
   * carry the narration, and a lingering "Thinking/Continuing" line from
   * the main agent would misreport waiting as activity (#165).
   */
  liveStatus(nowMs: number = Date.now(), availableWidth: number = 120): string | null {
    if (!this.group) return "Continuing";
    const elapsedMs = this.elapsedMs(nowMs);
    const failed = this.group.failedCount;
    const parts: string[] = [formatDuration(elapsedMs)];
    if (failed > 0) parts.push(`${failed} failed`);
    const suffix = ` (${parts.join(", ")})`;

    if (this.group.thinking) {
      // Trace stays hidden (impossible to read at stream speed) and derived
      // activity labels churn too much mid-derivation — the live line shows
      // plain "Thinking" with the elapsed tick. /show-think covers traces.
      this.group.lastLabel = "Thinking";
      return fitQuietLiveLine("Thinking", suffix, availableWidth);
    }
    if (this.group.tools.length > 0) {
      // Linger label must stay UNtruncated so later ticks re-fit against the
      // growing suffix instead of baking in a `…` from an earlier width.
      const unfitted = formatQuietLiveStatus({
        thinking: null,
        tools: this.group.tools,
        elapsedMs,
        failedCount: failed,
      });
      this.group.lastLabel = stripElapsed(unfitted);
      // The group line wears the "impulse" badge ONLY while subagents run
      // alongside main-agent tool calls — plain the rest of the time (#165).
      const concurrent = this.subagents.size > 0;
      const fitted = formatQuietLiveStatus({
        thinking: null,
        tools: this.group.tools,
        elapsedMs,
        failedCount: failed,
        availableWidth: concurrent
          ? availableWidth - ("impulse".length + BADGE_RESERVE)
          : availableWidth,
      });
      return concurrent ? `${impulseBadge()} ${fitted}` : fitted;
    }
    // Subagent-solo group: no main-agent activity to narrate → hide the line.
    if (this.subagents.size > 0) return null;
    // Nothing running: linger on the last activity label.
    const label = this.group.lastLabel ?? "Continuing";
    return fitQuietLiveLine(label, suffix, availableWidth);
  }

  /**
   * Commit Worked for once for the current group.
   * Idempotent: a second call for the same group returns null.
   */
  settle(nowMs: number = Date.now()): QuietSettleResult | null {
    const g = this.group;
    if (!g || !g.hadActivity || g.settled) {
      this.group = null;
      return null;
    }
    g.settled = true;
    const elapsedMs = Math.max(0, nowMs - g.startedAt);
    const failedSuffix =
      g.failedCount > 0 ? `, ${g.failedCount} failed` : "";
    const helperSuffix =
      g.helperCount > 0
        ? ` (${g.helperCount} subagent${g.helperCount === 1 ? "" : "s"})`
        : "";
    // Subagent-only groups skip "using N tools" — the task call IS the
    // subagent, and each subagent line already settled its own Worked for.
    const workedForLine =
      g.toolCount > 0 && g.toolCount !== g.helperCount
        ? `${formatWorkedFor(elapsedMs)} using ${g.toolCount} tool${g.toolCount === 1 ? "" : "s"}${helperSuffix}${failedSuffix}`
        : `${formatWorkedFor(elapsedMs)}${helperSuffix}${failedSuffix}`;
    const toolCount = g.toolCount;
    this.group = null;
    this.groupsSettled += 1;
    return { workedForLine, elapsedMs, toolCount };
  }
}

/** Strip a trailing " (4s)" / " (340ms)" elapsed tick from a composed label. */
function stripElapsed(label: string): string {
  return label.replace(/\s*\(([^()]*)\)\s*$/, "");
}

/**
 * Rolling tail of the live reasoning stream for the narration line —
 * the thinking equivalent of streaming display: the line keeps updating
 * with the newest words instead of freezing on the first sentence.
 * Returns null until the buffer is long enough to roll.
 *
 * Width-aware: `availableWidth` is the terminal width the narration line
 * may span (minus gutters); the tail grows to fill it — a full-screen
 * 187-col terminal shows ~160 chars of reasoning, a 66-col split shows
 * ~40. Starts at a word boundary, never mid-word.
 */
export function thinkingTailFor(
  buffer: string,
  availableWidth: number
): string | null {
  const normalized = buffer.replace(/\s+/g, " ").trim();
  if (normalized.length < 48) return null;
  const max = Math.max(24, Math.min(160, availableWidth - 14));
  let tail = normalized.slice(-max).trimStart();
  // Start at a word boundary unless the whole tail is one long word.
  const sp = tail.indexOf(" ");
  if (sp > 0 && sp <= tail.length - 8) {
    tail = tail.slice(sp + 1);
  }
  return tail;
}

/** Leading filler the reasoning stream opens with before the real intent. */
const THINKING_FILLER_RE =
  /^(i\s+(need|want)\s+to|i\s+(should|will)(?:\s+to)?|i\s+am\s+going\s+to|let\s+me|i'm\s+going\s+to|the\s+user\s+(wants|asks|asked)\s+(me\s+)?to|first,?|ok,?|alright,?|so,?|now,?)\s*/i;

/** Activity verbs → natural gerund labels ("review" → "Reviewing"). */
const GERUND_EXCEPTIONS: Record<string, string> = {
  set: "Setting",
  run: "Running",
  get: "Getting",
  put: "Putting",
  stop: "Stopping",
  map: "Mapping",
  plan: "Planning",
  scan: "Scanning",
  debug: "Debugging",
  format: "Formatting",
  ship: "Shipping",
  drop: "Dropping",
};
const KNOWN_ACTIVITY_VERBS = new Set([
  "review", "check", "examine", "analyze", "analyse", "read", "study",
  "search", "find", "verify", "validate", "test", "fix", "debug",
  "understand", "compare", "write", "create", "build", "update",
  "refactor", "implement", "scan", "trace", "inspect", "investigate",
  "plan", "design", "outline", "draft", "explore", "look", "set",
  "research", "map", "summarize", "summarise", "document", "audit",
  "assess", "evaluate", "profile", "migrate", "clean", "compile",
  "deploy", "configure", "install", "uninstall", "scaffold", "bootstrap",
  "orchestrate", "generate", "render", "parse", "translate", "convert",
  "format", "lint", "bundle", "publish", "release", "ship",
]);

function gerundOf(verb: string): string {
  const lower = verb.toLowerCase();
  if (GERUND_EXCEPTIONS[lower]) return GERUND_EXCEPTIONS[lower]!;
  if (/e$/.test(lower) && !/ee$/.test(lower)) {
    return `${verb.slice(0, -1)}ing`;
  }
  return `${verb}ing`;
}

/** Heuristic: clause opens with a capitalized/named subject (noun-led). */
const KNOWN_CLAUSE_NOUNS = /^(the|this|that|these|those|it|there|a|an)\b/i;

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Verb-led label for a thinking clause: "review the codebase" →
 * "Reviewing the codebase". Returns null when the clause doesn't start
 * with a known activity verb.
 */
export function activityLabelFor(clause: string): string | null {
  const words = clause.trim().split(/\s+/);
  if (words.length === 0) return null;
  const first = words[0]!.toLowerCase().replace(/[^a-z]/g, "");
  if (!KNOWN_ACTIVITY_VERBS.has(first)) return null;
  const rest = words.slice(1).join(" ");
  const label = `${gerundOf(words[0]!)}${rest ? ` ${rest}` : ""}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Derive a narration intent phrase from the start of the reasoning stream.
 * Returns null until there is enough signal (≥4 words after filler-strip).
 */
export function deriveIntentFromThinking(buffer: string): string | null {
  let rest = buffer.trim();
  if (rest.length < 12) return null;
  for (let i = 0; i < 3; i++) {
    rest = rest.replace(THINKING_FILLER_RE, "");
  }
  const sentence = rest.split(/(?<=[.!?;:])\s/)[0] ?? rest;
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;
  return words
    .slice(0, 8)
    .join(" ")
    .replace(/[.,;:]+$/, "")
    .slice(0, 60);
}

export const BUSY_STEERING = "Steering…";
export const BUSY_QUEUED = "Queued";
