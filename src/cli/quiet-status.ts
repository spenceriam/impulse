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
    const p = typeof args["path"] === "string" ? String(args["path"]) : ".";
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

export function quietToolVerb(name: string): string {
  return QUIET_VERBS[name] ?? `Running ${name}`;
}

/** Fixed thinking phrases for Quiet live line. */
export function quietThinkingPhrase(kind: "assessing" | "planning"): string {
  return kind === "planning" ? "Planning…" : "Assessing…";
}

/**
 * Live shimmer line for a Quiet work group.
 * Parallel tools: "Reading AGENTS.md… (+2)"
 */
export function formatQuietLiveStatus(opts: {
  thinking?: "assessing" | "planning" | null;
  tools: QuietInflightTool[];
}): string {
  const running = opts.tools;
  if (running.length > 0) {
    const first = running[0]!;
    const verb = quietToolVerb(first.name);
    const arg = first.arg;
    const base = arg ? `${verb} ${arg}…` : `${verb}…`;
    const extra = running.length - 1;
    return extra > 0 ? `${base} (+${extra})` : base;
  }
  if (opts.thinking) {
    return quietThinkingPhrase(opts.thinking);
  }
  return "Working…";
}

/**
 * Wall-clock commit line when a Quiet work group settles.
 * ≥1s → whole seconds; &lt;1s → milliseconds (never `0s`).
 */
export function formatWorkedFor(elapsedMs: number): string {
  const ms = Math.max(0, Math.round(elapsedMs));
  if (ms < 1000) {
    return `Worked for ${ms}ms`;
  }
  return `Worked for ${Math.round(ms / 1000)}s`;
}

/** Past-tense outcome verbs for done→next Recap facts. */
const QUIET_OUTCOME_VERBS: Record<string, string> = {
  file_read: "read",
  file_write: "wrote",
  file_edit: "edited",
  glob: "found",
  grep: "searched",
  ls: "listed",
  bash: "ran",
  task: "delegated",
  web_search: "searched",
  web_fetch: "fetched",
  todo_write: "updated todos",
  todo_read: "read todos",
  question: "asked",
  github_issue: "filed issue",
  plan_revision: "revised plan",
  install_skill: "installed skill",
  vision_translate: "translated",
};

export function quietOutcomeVerb(name: string): string {
  return QUIET_OUTCOME_VERBS[name] ?? name.replace(/_/g, " ");
}

/** Optional Next signals — omit `· Next:` when none are available (never invent). */
export type QuietRecapNextHints = {
  /** in_progress or first pending todo content */
  pendingTodo?: string | null;
  /** Short label from last failed/blocked tool */
  lastFailure?: string | null;
  /** First open unchecked plan task */
  openPlanItem?: string | null;
};

/**
 * Pick one concrete Next clause. Priority: pending/in-progress todo → last failure → open plan.
 * Returns null when nothing usable (caller omits `· Next:`).
 */
export function pickQuietRecapNext(hints: QuietRecapNextHints = {}): string | null {
  const todo = hints.pendingTodo?.trim();
  if (todo) return truncateArg(todo, 48);
  const fail = hints.lastFailure?.trim();
  if (fail) return truncateArg(fail, 48);
  const plan = hints.openPlanItem?.trim();
  if (plan) return truncateArg(plan, 48);
  return null;
}

/** First unchecked markdown task `- [ ] …` from plan tasks.md, or null. */
export function extractOpenPlanItem(tasksMarkdown: string | null | undefined): string | null {
  if (!tasksMarkdown) return null;
  const match = tasksMarkdown.match(/^\s*[-*]\s+\[\s\]\s+(.+)$/m);
  const item = match?.[1]?.trim();
  return item ? item : null;
}

/** Build last-failure Next label from events (most recent failed/blocked). */
export function lastFailureNextLabel(events: QuietRecapEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.outcome !== "failed" && ev.outcome !== "blocked") continue;
    if (ev.arg) return `retry ${ev.arg}`;
    return `retry ${quietOutcomeVerb(ev.name)}`;
  }
  return null;
}

/**
 * Event-sourced done→next Recap.
 * Shape: `Recap: edited auth.ts, ran tests ✓ · Next: token-refresh test`
 * Omits `· Next:` when no next signal. Never invents Next. No LLM.
 */
export function formatQuietRecap(
  events: QuietRecapEvent[],
  nextHints: QuietRecapNextHints = {}
): string | null {
  if (events.length === 0) return null;

  const parts: string[] = [];
  const seen = new Set<string>();
  let successCount = 0;

  for (const ev of events) {
    if (ev.outcome !== "success") continue;
    const verb = quietOutcomeVerb(ev.name);
    const key = ev.arg ? `${verb}:${ev.arg}` : verb;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(ev.arg ? `${verb} ${ev.arg}` : verb);
    successCount++;
    if (parts.length >= 3) break;
  }

  const failed = events.filter((e) => e.outcome === "failed" || e.outcome === "blocked");
  if (parts.length === 0 && failed.length === 0) {
    return null;
  }

  let done = parts.join(", ");
  if (failed.length > 0) {
    const f = failed[failed.length - 1]!;
    const status = f.outcome === "blocked" ? "blocked" : "failed";
    const failBit = f.arg
      ? `${quietOutcomeVerb(f.name)} ${f.arg} ${status}`
      : `${quietOutcomeVerb(f.name)} ${status}`;
    done = done ? `${done}; ${failBit}` : failBit;
  } else if (successCount > 0) {
    done = `${done} ✓`;
  }

  const lastFailure =
    nextHints.lastFailure !== undefined
      ? nextHints.lastFailure
      : lastFailureNextLabel(events);

  const next = pickQuietRecapNext({
    pendingTodo: nextHints.pendingTodo ?? null,
    lastFailure,
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
    tools: QuietInflightTool[];
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

  get tools(): QuietInflightTool[] {
    return this.group?.tools ?? [];
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
      tools: [],
      hadActivity: false,
      hadTools: false,
      settled: false,
    };
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

  addTool(tool: QuietInflightTool, nowMs: number = Date.now()): void {
    this.ensure(nowMs);
    const g = this.group!;
    g.thinking = null;
    g.hadActivity = true;
    g.hadTools = true;
    g.tools.push(tool);
  }

  removeTool(id: string): void {
    if (!this.group) return;
    this.group.tools = this.group.tools.filter((t) => t.id !== id);
  }

  findToolArg(id: string): string | undefined {
    return this.group?.tools.find((t) => t.id === id)?.arg;
  }

  liveStatus(): string {
    if (!this.group) return "Working…";
    return formatQuietLiveStatus({
      thinking: this.group.thinking,
      tools: this.group.tools,
    });
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
    const elapsed = Math.max(0, nowMs - g.startedAt);
    const workedForLine = formatWorkedFor(elapsed);
    this.group = null;
    this.groupsSettled += 1;
    return { workedForLine };
  }
}

export const BUSY_STEERING = "Steering…";
export const BUSY_QUEUED = "Queued";
