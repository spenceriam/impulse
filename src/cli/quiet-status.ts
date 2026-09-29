/**
 * Quiet chat density helpers (#153).
 * Templated live status, Worked for commit, event-sourced Recap.
 * No model-authored status; no extra LLM call for Recap.
 */

import path from "path";

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

/** Wall-clock commit line when a Quiet work group settles. */
export function formatWorkedFor(elapsedMs: number): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `Worked for ${seconds}s`;
}

/**
 * Event-sourced Recap (~1 short line). Returns null when nothing to show.
 */
export function formatQuietRecap(events: QuietRecapEvent[]): string | null {
  if (events.length === 0) return null;

  const parts: string[] = [];
  const seen = new Set<string>();

  for (const ev of events) {
    if (ev.outcome !== "success") continue;
    const verb = quietToolVerb(ev.name).toLowerCase();
    const key = ev.arg ? `${verb}:${ev.arg}` : verb;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(ev.arg ? `${verb} ${ev.arg}` : verb);
    if (parts.length >= 3) break;
  }

  const failed = events.filter((e) => e.outcome === "failed" || e.outcome === "blocked");
  if (parts.length === 0 && failed.length === 0) {
    // Only aborted / silent — skip recap
    return null;
  }

  let line = parts.length > 0 ? parts.join(", ") : "";
  if (failed.length > 0) {
    const failBit =
      failed.length === 1
        ? `${quietToolVerb(failed[0]!.name).toLowerCase()} blocked`
        : `${failed.length} tools blocked`;
    line = line ? `${line}; ${failBit}` : failBit;
  }

  // Cap roughly one short line
  if (line.length > 100) {
    line = `${line.slice(0, 99)}…`;
  }
  return `Recap: ${line}`;
}

export const BUSY_STEERING = "Steering…";
export const BUSY_QUEUED = "Queued";
