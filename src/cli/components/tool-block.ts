/**
 * ToolBlock — renders a tool call in-place.
 *
 * Running tools animate with lightweight spinners. Completed tools keep a
 * visible summary, while noisy raw output is suppressed unless the tool failed
 * or returns structured metadata worth showing (todos, task actions).
 */

import { truncateToWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import {
  TypeGuards,
  type FileEditMetadata,
  type FileWriteMetadata,
  type GlobMetadata,
  type GrepMetadata,
  type ToolMetadata,
  type TodoMetadata,
} from "../../types/tool-metadata.js";

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  strike: "\x1b[9m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

const clr = {
  toolName: (s: string) => c.fg(36, s),
  args: (s: string) => c.fg(90, s),
  success: (s: string) => c.fg(32, s),
  error: (s: string) => c.fg(31, s),
  running: (s: string) => c.fg(33, s),
  dim: (s: string) => c.fg(90, s),
  duration: (s: string) => c.fg(90, s),
  pending: (s: string) => c.fg(90, s),
};

const TOOL_SPINNER = ["··●", "·●·", "●··", "·●·"];
const QUESTION_SPINNER = [">--", "->-", "-->", "--<", "-<-", "<--"];
const TOOL_FRAME_MS = 180;
const QUESTION_FRAME_MS = 160;
const MAX_OUTPUT_ROWS = 30;
const MAX_TODO_ROWS = 12;

type RenderedResult = {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
};

export type ToolBlockState =
  | { status: "running"; name: string; argsSummary: string }
  | { status: "done"; name: string; argsSummary: string; result: RenderedResult; durationMs: number };

type Outcome = "success" | "failed" | "blocked" | "aborted";

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "question") {
    const context = typeof args["context"] === "string" ? String(args["context"]) : "";
    return context.length > 0 ? context.slice(0, 70) : "waiting for your answer…";
  }

  if (name === "todo_write") return "updating todos";
  if (name === "todo_read") return "reading todos";

  if (name === "task") {
    const description = typeof args["description"] === "string" ? String(args["description"]) : "delegating subagent task";
    return description.length > 70 ? `${description.slice(0, 67)}…` : description;
  }

  if (name === "glob") {
    const pattern = typeof args["pattern"] === "string" ? String(args["pattern"]) : "pattern";
    const path = typeof args["path"] === "string" ? ` in ${String(args["path"])}` : "";
    return `${pattern}${path}`.slice(0, 70);
  }

  if (name === "grep") {
    const pattern = typeof args["pattern"] === "string" ? String(args["pattern"]) : "pattern";
    const path = typeof args["path"] === "string" ? ` in ${String(args["path"])}` : "";
    const include = typeof args["include"] === "string" ? ` (${String(args["include"])})` : "";
    return `${pattern}${path}${include}`.slice(0, 70);
  }

  const keys = ["path", "filePath", "file", "command", "pattern", "query", "description", "prompt", "url"];
  for (const key of keys) {
    if (typeof args[key] === "string") {
      const value = String(args[key]);
      return value.length > 70 ? `${value.slice(0, 67)}…` : value;
    }
  }

  return Object.entries(args)
    .slice(0, 1)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("")
    .slice(0, 70);
}

function asToolMetadata(value: Record<string, unknown> | undefined): ToolMetadata | null {
  if (!value || typeof value["type"] !== "string") return null;
  return value as unknown as ToolMetadata;
}

function wrapPrefixed(prefix: string, text: string, width: number): string[] {
  const available = Math.max(8, width - prefix.length);
  const wrapped = wrapTextWithAnsi(text.length > 0 ? text : " ", available);
  return wrapped.map((line) => truncateToWidth(`${prefix}${line}`, width));
}

function renderTrimmedOutput(output: string, width: number, maxRows: number): string[] {
  const normalized = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!normalized) return [];

  const rendered: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    rendered.push(...wrapPrefixed("     ", rawLine, width));
  }

  if (rendered.length <= maxRows) {
    return rendered;
  }

  const hidden = rendered.length - maxRows;
  return [
    ...rendered.slice(0, maxRows),
    truncateToWidth(`     ${clr.dim(`… ${hidden} more lines`)}`, width),
  ];
}

function todoLine(todo: TodoMetadata["todos"][number]): string {
  switch (todo.status) {
    case "in_progress":
      return `${clr.running("[>]")} ${todo.content}`;
    case "completed":
      return `${clr.dim("[✓]")} ${c.dim}${c.strike}${todo.content}${c.reset}`;
    case "cancelled":
      return `${clr.dim("[-]")} ${c.dim}${c.strike}${todo.content}${c.reset}`;
    default:
      return `${clr.pending("[ ]")} ${todo.content}`;
  }
}

function renderTodoList(metadata: TodoMetadata, width: number): string[] {
  const visibleTodos = metadata.todos.slice(0, MAX_TODO_ROWS);
  const lines = visibleTodos.flatMap((todo) => wrapPrefixed("     ", todoLine(todo), width));

  if (metadata.todos.length > MAX_TODO_ROWS) {
    lines.push(truncateToWidth(`     ${clr.dim(`… ${metadata.todos.length - MAX_TODO_ROWS} more items`)}`, width));
  }

  return lines;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

function colorCompactDiffLine(line: string): string {
  const display = replaceTabs(line);
  if (display.startsWith("+")) return clr.success(display);
  if (display.startsWith("-")) return `\x1b[31m${c.strike}${display}${c.reset}`;
  return clr.dim(display);
}

function renderCompactDiffLines(diffLines: string[], width: number, maxRows = MAX_OUTPUT_ROWS): string[] {
  if (diffLines.length === 0) return [];

  const visible = diffLines.slice(0, maxRows).map((line) => {
    return truncateToWidth(`     ${colorCompactDiffLine(line)}`, width);
  });

  if (diffLines.length > maxRows) {
    visible.push(truncateToWidth(`     ${clr.dim(`… ${diffLines.length - maxRows} more diff lines`)}`, width));
  }

  return visible;
}

function renderLegacyDiff(diff: string, width: number): string[] {
  const meaningfulLines = diff
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => {
      if (line.startsWith("Index:")) return false;
      if (line.startsWith("===") || line.startsWith("---") || line.startsWith("+++")) return false;
      return line.length > 0;
    });

  return renderCompactDiffLines(meaningfulLines, width);
}

function renderDiffSkipped(reason: string | undefined, width: number): string[] {
  return [truncateToWidth(`     ${clr.dim(`diff skipped: ${reason ?? "not available"}`)}`, width)];
}

function renderFileEditMetadata(metadata: FileEditMetadata, width: number): string[] {
  if (metadata.diffSkipped) {
    return renderDiffSkipped(metadata.diffReason, width);
  }

  const replacements = metadata.replacements ?? 1;
  const lines = [
    truncateToWidth(
      `     ${clr.dim("~")} ${clr.dim(`${replacements} ${pluralize(replacements, "replacement")},`)} ${clr.success(`+${metadata.linesAdded}`)} ${clr.error(`-${metadata.linesRemoved}`)}`,
      width,
    ),
  ];

  if (metadata.compactDiff && metadata.compactDiff.length > 0) {
    lines.push("     ");
    lines.push(...renderCompactDiffLines(metadata.compactDiff, width));
  } else if (metadata.diff) {
    lines.push("     ");
    lines.push(...renderLegacyDiff(metadata.diff, width));
  } else {
    lines.push(truncateToWidth(`     ${clr.dim("no visible diff")}`, width));
  }

  return lines;
}

function renderFileWriteMetadata(metadata: FileWriteMetadata, width: number): string[] {
  const linesAdded = metadata.linesAdded ?? 0;
  const linesRemoved = metadata.linesRemoved ?? 0;
  const summary = metadata.created
    ? `${clr.success("+")} ${clr.success(`${metadata.linesWritten} ${pluralize(metadata.linesWritten, "line")} created`)}`
    : `${clr.dim("~")} ${clr.dim("overwritten,")} ${clr.success(`+${linesAdded}`)} ${clr.error(`-${linesRemoved}`)}`;
  const lines = [truncateToWidth(`     ${summary}`, width)];

  if (metadata.diffSkipped) {
    lines.push(...renderDiffSkipped(metadata.diffReason, width));
    return lines;
  }

  if (metadata.compactDiff && metadata.compactDiff.length > 0) {
    lines.push("     ");
    lines.push(...renderCompactDiffLines(metadata.compactDiff, width));
  } else if (metadata.diff) {
    lines.push("     ");
    lines.push(...renderLegacyDiff(metadata.diff, width));
  } else if (!metadata.created && linesAdded === 0 && linesRemoved === 0) {
    lines.push(truncateToWidth(`     ${clr.dim("no content changes")}`, width));
  }

  return lines;
}

function renderGlobMetadata(metadata: GlobMetadata, width: number): string[] {
  const total = metadata.totalMatches ?? metadata.matchCount;
  const countText = metadata.truncated
    ? `${metadata.matchCount}/${total} matches shown`
    : `${metadata.matchCount} ${pluralize(metadata.matchCount, "match", "matches")}`;
  const path = metadata.path ? `  path ${metadata.path}` : "";
  return [truncateToWidth(`     ${clr.dim("found")} ${countText}  ${clr.dim("pattern")} ${metadata.pattern}${path}`, width)];
}

function renderGrepMetadata(metadata: GrepMetadata, width: number): string[] {
  const countText = `${metadata.matchCount} ${pluralize(metadata.matchCount, "match", "matches")}`;
  const path = metadata.path ? `  path ${metadata.path}` : "";
  const include = metadata.include ? `  include ${metadata.include}` : "";
  const suffix = metadata.truncated ? "  truncated" : "";
  return [truncateToWidth(`     ${clr.dim("found")} ${countText}  ${clr.dim("pattern")} ${metadata.pattern}${path}${include}${suffix}`, width)];
}

function classifyOutcome(result: RenderedResult): Outcome {
  if (result.success) return "success";

  const output = result.output.toLowerCase();
  if (output.includes("[user decision]") || output.includes("permission denied")) {
    return "blocked";
  }
  if (output.includes("aborted") || output.includes("cancelled") || output.includes("canceled")) {
    return "aborted";
  }
  return "failed";
}

function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case "blocked":
      return clr.dim("[blocked]");
    case "aborted":
      return clr.dim("[aborted]");
    default:
      return "";
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 100) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function currentSpinner(name: string): string {
  const frames = name === "question" ? QUESTION_SPINNER : TOOL_SPINNER;
  const frameMs = name === "question" ? QUESTION_FRAME_MS : TOOL_FRAME_MS;
  const index = Math.floor(Date.now() / frameMs) % frames.length;
  return frames[index] ?? frames[0] ?? "...";
}

function renderMetadata(metadata: ToolMetadata | null, output: string, success: boolean, width: number): string[] {
  if (metadata && TypeGuards.isTodo(metadata)) {
    return renderTodoList(metadata, width);
  }

  if (metadata && TypeGuards.isTask(metadata) && metadata.actions.length > 0) {
    const actions = metadata.actions.slice(0, 6).flatMap((action) => wrapPrefixed("     - ", action, width));
    if (metadata.actions.length > 6) {
      actions.push(truncateToWidth(`     ${clr.dim(`… ${metadata.actions.length - 6} more actions`)}`, width));
    }
    return actions;
  }

  if (success && metadata && TypeGuards.isFileEdit(metadata)) {
    return renderFileEditMetadata(metadata, width);
  }

  if (success && metadata && TypeGuards.isFileWrite(metadata)) {
    return renderFileWriteMetadata(metadata, width);
  }

  if (success && metadata && TypeGuards.isGlob(metadata)) {
    return renderGlobMetadata(metadata, width);
  }

  if (success && metadata && TypeGuards.isGrep(metadata)) {
    return renderGrepMetadata(metadata, width);
  }

  if (!success) {
    return renderTrimmedOutput(output, width, MAX_OUTPUT_ROWS);
  }

  return [];
}

export class ToolBlock implements Component {
  private state: ToolBlockState;

  constructor(name: string, args: Record<string, unknown>) {
    this.state = {
      status: "running",
      name,
      argsSummary: summarizeArgs(name, args),
    };
  }

  setDone(result: RenderedResult, durationMs: number): void {
    this.state = {
      status: "done",
      name: this.state.name,
      argsSummary: this.state.argsSummary,
      result,
      durationMs,
    };
  }

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.state;

    if (state.status === "running") {
      const spinner = clr.running(currentSpinner(state.name));
      return [truncateToWidth(`  ${spinner} ${clr.toolName(state.name)}  ${clr.args(state.argsSummary)}`, width)];
    }

    const outcome = classifyOutcome(state.result);
    const icon = outcome === "success" ? clr.success("✓") : clr.error("✗");
    const label = outcomeLabel(outcome);
    const duration = clr.duration(formatDuration(state.durationMs));
    const suffix = label.length > 0 ? `  ${label}` : "";
    const lines = [truncateToWidth(`  ${icon} ${clr.toolName(state.name)}  ${clr.args(state.argsSummary)}${suffix}  ${duration}`, width)];
    const metadata = asToolMetadata(state.result.metadata);
    lines.push(...renderMetadata(metadata, state.result.output, state.result.success, width));
    return lines;
  }
}
