/**
 * Quiet chat density helpers (#153).
 * Templated live status, Worked for commit, event-sourced Recap.
 * No model-authored status; no extra LLM call for Recap.
 */

import path from "path";
import { wrapTextWithAnsi, truncateToWidth } from "@mariozechner/pi-tui";

export type QuietToolOutcome = "success" | "failed" | "blocked" | "aborted";

export type QuietInflightTool = {
  id: string;
  name: string;
  arg: string;
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
export function fullQuietArg(name: string, args: Record<string, unknown>): string {
  if (name === "todo_write" || name === "todo_read") return "";
  if (name === "task") {
    const description =
      typeof args["description"] === "string" ? String(args["description"]).trim() : "";
    return description || "subagent";
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
    if (!p || p === "." || p === "./") return ".";
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
export function quietThinkingPhrase(kind: "assessing" | "planning"): string {
  return kind === "planning" ? "Planning…" : "Assessing…";
}

/**
 * Live shimmer narration for a Quiet work group.
 * Narrates the current activity with a ticking elapsed time; lives in the
 * chat scrollback at the current insertion point and hardens in place on
 * settle. Parallel tools: "Reading AGENTS.md… (+2) (4s)".
 */
export function formatQuietLiveStatus(opts: {
  thinking?: "assessing" | "planning" | null;
  thinkingIntent?: string | null;
  tools: QuietInflightTool[];
  elapsedMs?: number;
}): string {
  const elapsed = formatElapsedTick(opts.elapsedMs);
  const running = opts.tools;
  if (running.length > 0) {
    const first = running[0]!;
    const verb = quietToolVerb(first.name);
    const arg = first.arg;
    const base = arg ? `${verb} ${arg}…` : `${verb}…`;
    const extra = running.length - 1;
    const label = extra > 0 ? `${base} (+${extra})` : base;
    return elapsed ? `${label} (${elapsed})` : label;
  }
  if (opts.thinking) {
    const intent = opts.thinkingIntent?.trim();
    let label: string;
    if (intent) {
      label =
        opts.thinking === "planning"
          ? `Thinking about ${intent}…`
          : `Planning to ${intent}…`;
    } else {
      label = quietThinkingPhrase(opts.thinking);
    }
    return elapsed ? `${label} (${elapsed})` : label;
  }
  return "Working…";
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
 * Plain-language intent for common shell commands. Returns null when no
 * confident mapping exists (caller falls back to the concrete command).
 */
function plainBashIntent(command: string): string | null {
  const c = command.replace(/\s+/g, " ").trim().toLowerCase();
  const starts = (...prefixes: string[]) => prefixes.some((p) => c.startsWith(p));
  if (starts("git log", "git show", "git reflog")) return "reviewed recent changes";
  if (starts("git diff")) return "reviewed the current changes";
  if (starts("git status")) return "checked what changed in the repo";
  if (starts("git commit")) return "made a commit";
  if (starts("git push")) return "pushed commits";
  if (starts("git pull", "git fetch")) return "pulled the latest changes";
  if (starts("git branch", "git tag")) return "checked the repo branches";
  if (starts("npm test", "bun test", "yarn test", "go test", "cargo test", "pytest", "jest", "vitest"))
    return "ran the tests";
  if (starts("grep", "rg ", "ag ")) return "searched the codebase";
  if (starts("ls", "find ", "tree")) return "checked the folder contents";
  if (starts("cat", "head", "tail", "less", "more")) return "looked at a file";
  if (starts("curl", "wget")) return "fetched a web page";
  if (starts("mkdir", "touch")) return "set up files";
  if (starts("rm", "mv", "cp")) return "reorganized files";
  return null;
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
      const intent = plainBashIntent(cmd);
      if (intent) return `${intent}${statusSuffix}`;
      const short = truncateArg(cmd.replace(/\s+/g, " ").trim(), 40);
      if (isVagueRecapNoun(short)) return null;
      return `ran ${short}${statusSuffix}`;
    }
    case "web_search": {
      if (isVagueRecapNoun(arg)) return null;
      return `searched the web for ${truncateArg(arg, 32)}`;
    }
    case "web_fetch": {
      if (isVagueRecapNoun(arg)) return null;
      return `fetched ${truncateArg(arg, 36)}`;
    }
    case "task": {
      if (isVagueRecapNoun(arg) || arg === "subagent") return null;
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
    // Prefer concrete retry target from fact/arg
    if (ev.arg && !isVagueRecapNoun(ev.arg)) return `retry ${truncateArg(ev.arg, 40)}`;
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

  let done = capped.join("; ");
  if (failed.length === 0 && anySuccess) {
    done = `${done} ✓`;
  }

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
export function wrapQuietRecapLines(
  recapLine: string,
  width: number,
  maxLines = 3
): string[] {
  const avail = Math.max(8, width);
  const wrapped = wrapTextWithAnsi(recapLine, avail);
  if (wrapped.length === 0) return [];
  if (wrapped.length <= maxLines) return wrapped;

  const kept = wrapped.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  // Leave room for ellipsis
  const ellipsis = "…";
  const truncated = truncateToWidth(last, Math.max(1, avail - ellipsis.length));
  kept[maxLines - 1] = `${truncated}${ellipsis}`;
  return kept;
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
    g.tools.push(tool);
  }

  removeTool(id: string): void {
    if (!this.group) return;
    this.group.tools = this.group.tools.filter((t) => t.id !== id);
  }

  findToolArg(id: string): string | undefined {
    return this.group?.tools.find((t) => t.id === id)?.arg;
  }

  liveStatus(nowMs: number = Date.now()): string {
    if (!this.group) return "Continuing…";
    const elapsedMs = this.elapsedMs(nowMs);
    if (this.group.thinking || this.group.tools.length > 0) {
      let label: string;
      if (this.group.thinking) {
        const tail = rollingThinkingTail(this.group.thinkingBuffer);
        label = tail
          ? `Thinking … ${tail}`
          : formatQuietLiveStatus({
              thinking: this.group.thinking,
              thinkingIntent: this.group.thinkingIntent,
              tools: [],
            });
      } else {
        label = formatQuietLiveStatus({
          thinking: null,
          tools: this.group.tools,
        });
      }
      // Remember the last real activity so the line lingers on it while the
      // model thinks/waits instead of blanking to a generic phrase.
      this.group.lastLabel = stripElapsed(label);
      return withFailureMark(
        elapsedMs ? `${label} (${formatDuration(elapsedMs)})` : label,
        this.group.failedCount
      );
    }
    // Nothing running: linger on the last activity label.
    const lingering = this.group.lastLabel;
    const label = lingering ?? "Continuing…";
    return withFailureMark(
      elapsedMs ? `${label} (${formatDuration(elapsedMs)})` : label,
      this.group.failedCount
    );
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
      g.failedCount > 0 ? ` · ${g.failedCount} failed` : "";
    const workedForLine =
      g.toolCount > 0
        ? `${formatWorkedFor(elapsedMs)} using ${g.toolCount} tool${g.toolCount === 1 ? "" : "s"}${failedSuffix}`
        : formatWorkedFor(elapsedMs);
    const toolCount = g.toolCount;
    this.group = null;
    this.groupsSettled += 1;
    return { workedForLine, elapsedMs, toolCount };
  }
}

/** Append a ✗ mark to the live narration when tools failed in this group. */
function withFailureMark(label: string, failedCount: number): string {
  if (failedCount <= 0) return label;
  const n = failedCount === 1 ? "" : `${failedCount} `;
  return `${label} · ${n}✗`;
}

/** Strip a trailing " (4s)" / " (340ms)" elapsed tick from a composed label. */
function stripElapsed(label: string): string {
  return label.replace(/\s*\(\d+(?:\.\d+)?m?s\)$/, "");
}

/**
 * Rolling tail of the live reasoning stream for the narration line —
 * the thinking equivalent of streaming display: the line keeps updating
 * with the newest words instead of freezing on the first sentence.
 * Returns null until the buffer is long enough to roll.
 */
export function rollingThinkingTail(buffer: string): string | null {
  const normalized = buffer.replace(/\s+/g, " ").trim();
  if (normalized.length < 48) return null;
  const tail = normalized.slice(-44).trimStart();
  return tail;
}

/** Leading filler the reasoning stream opens with before the real intent. */
const THINKING_FILLER_RE =
  /^(i\s+(need|want|should|will|am\s+going)\s+to|let\s+me|i'm\s+going\s+to|the\s+user\s+(wants|asks|asked)\s+(me\s+)?to|first,?|ok,?|alright,?|so,?|now,?)\s*/i;

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
