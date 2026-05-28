/**
 * ToolBlock — renders a tool call in-place.
 *
 * Running tools animate with lightweight spinners. Completed tools keep a
 * visible summary, while noisy raw output is suppressed unless the tool failed
 * or returns structured metadata worth showing (todos, task actions).
 */

import { truncateToWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER } from "../gutter.js";

/** Sub-indent for continuation lines under a tool block (GUTTER + 3 more spaces) */
const SUB_INDENT = GUTTER + "   ";

/** Sub-agent / task-action list lines: SUB_INDENT + 2 gutter widths + bullet */
export const SUBAGENT_LINE_PREFIX = SUB_INDENT + GUTTER + GUTTER + "- ";
import {
  TypeGuards,
  type FileEditMetadata,
  type FileWriteMetadata,
  type GlobMetadata,
  type GrepMetadata,
  type ToolMetadata,
  type TaskActionEntry,
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

export type ToolBlockOptions = {
  subagentCodename?: string;
};

type TodoPreviewItem = TodoMetadata["todos"][number];

export type ToolBlockState =
  | {
      status: "running";
      name: string;
      argsSummary: string;
      subagentCodename?: string;
      previewTodos?: TodoPreviewItem[];
      taskStartedAt?: number;
    }
  | {
      status: "done";
      name: string;
      argsSummary: string;
      subagentCodename?: string;
      result: RenderedResult;
      durationMs: number;
    };

export function displayToolName(name: string, codename?: string): string {
  if (name === "task" && codename) return `task (${codename})`;
  if (name === "task") return "task (sub-agent)";
  return name;
}

export function formatSubagentAbortLabel(codename?: string): string {
  if (codename) return `[${codename} sub-agent aborted]`;
  return "[sub-agent aborted]";
}

export type SubagentProgressLine = {
  type: "text" | "tool" | "thinking";
  content: string;
  durationMs?: number;
};

export function isUserDecisionToolOutput(output: string): boolean {
  return output.toLowerCase().includes("[user decision]");
}

type Outcome = "success" | "failed" | "blocked" | "aborted";

const TODO_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

function parseTodosFromArgs(args: Record<string, unknown>): TodoPreviewItem[] | undefined {
  const raw = args["todos"];
  if (!Array.isArray(raw)) return undefined;

  const parsed: TodoPreviewItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    const content = typeof record["content"] === "string" ? record["content"] : "";
    const status = typeof record["status"] === "string" ? record["status"] : "";
    if (!id || !content || !TODO_STATUSES.has(status)) continue;
    const priority =
      record["priority"] === "high" || record["priority"] === "low"
        ? record["priority"]
        : "medium";
    parsed.push({
      id,
      content,
      status: status as TodoPreviewItem["status"],
      priority,
    });
  }

  return parsed.length > 0 ? parsed : undefined;
}

function summarizeTodoCounts(todos: TodoPreviewItem[]): string {
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const cancelled = todos.filter((t) => t.status === "cancelled").length;
  const done = completed + cancelled;

  if (total === 0) return "todos";
  if (done === total) return `${done}/${total} done`;
  if (inProgress > 0 && completed > 0) {
    return `${completed} done, ${inProgress} in progress`;
  }
  if (inProgress > 0) return `${inProgress} in progress`;
  return `${done}/${total} done`;
}

export function summarizeTodoArgs(name: string, args: Record<string, unknown>): string {
  if (name === "todo_read") return "read todos";
  if (name === "todo_write") {
    const todos = parseTodosFromArgs(args);
    if (todos) return summarizeTodoCounts(todos).slice(0, 50);
    return "todos";
  }
  return "todos";
}

function summarizeTodoDoneSummary(name: string, metadata: TodoMetadata): string {
  const counts = summarizeTodoCounts(metadata.todos);
  if (name === "todo_write") return `todos updated · ${counts}`.slice(0, 70);
  if (metadata.total === 0) return "read todos · empty";
  return `read todos · ${counts}`.slice(0, 70);
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "question") {
    const context = typeof args["context"] === "string" ? String(args["context"]) : "";
    return context.length > 0 ? context.slice(0, 70) : "waiting for your answer…";
  }

  if (name === "todo_write" || name === "todo_read") {
    return summarizeTodoArgs(name, args);
  }

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
    rendered.push(...wrapPrefixed(SUB_INDENT, rawLine, width));
  }

  if (rendered.length <= maxRows) {
    return rendered;
  }

  const hidden = rendered.length - maxRows;
  return [
    ...rendered.slice(0, maxRows),
    truncateToWidth(`       ${clr.dim(`… ${hidden} more lines`)}`, width),
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

function renderTodoListFromTodos(todos: TodoPreviewItem[], width: number): string[] {
  const visibleTodos = todos.slice(0, MAX_TODO_ROWS);
  const lines = visibleTodos.flatMap((todo) => wrapPrefixed(SUB_INDENT, todoLine(todo), width));

  if (todos.length > MAX_TODO_ROWS) {
    lines.push(truncateToWidth(`       ${clr.dim(`… ${todos.length - MAX_TODO_ROWS} more items`)}`, width));
  }

  return lines;
}

function renderTodoList(metadata: TodoMetadata, width: number): string[] {
  return renderTodoListFromTodos(metadata.todos, width);
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
    return truncateToWidth(`       ${colorCompactDiffLine(line)}`, width);
  });

  if (diffLines.length > maxRows) {
    visible.push(truncateToWidth(`       ${clr.dim(`… ${diffLines.length - maxRows} more diff lines`)}`, width));
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
  return [truncateToWidth(`       ${clr.dim(`diff skipped: ${reason ?? "not available"}`)}`, width)];
}

function renderFileEditMetadata(metadata: FileEditMetadata, width: number): string[] {
  if (metadata.diffSkipped) {
    return renderDiffSkipped(metadata.diffReason, width);
  }

  const replacements = metadata.replacements ?? 1;
  const lines = [
    truncateToWidth(
      `       ${clr.dim("~")} ${clr.dim(`${replacements} ${pluralize(replacements, "replacement")},`)} ${clr.success(`+${metadata.linesAdded}`)} ${clr.error(`-${metadata.linesRemoved}`)}`,
      width,
    ),
  ];

  if (metadata.compactDiff && metadata.compactDiff.length > 0) {
    lines.push(SUB_INDENT);
    lines.push(...renderCompactDiffLines(metadata.compactDiff, width));
  } else if (metadata.diff) {
    lines.push(SUB_INDENT);
    lines.push(...renderLegacyDiff(metadata.diff, width));
  } else {
    lines.push(truncateToWidth(`       ${clr.dim("no visible diff")}`, width));
  }

  return lines;
}

function renderFileWriteMetadata(metadata: FileWriteMetadata, width: number): string[] {
  const linesAdded = metadata.linesAdded ?? 0;
  const linesRemoved = metadata.linesRemoved ?? 0;
  const summary = metadata.created
    ? `${clr.success("+")} ${clr.success(`${metadata.linesWritten} ${pluralize(metadata.linesWritten, "line")} created`)}`
    : `${clr.dim("~")} ${clr.dim("overwritten,")} ${clr.success(`+${linesAdded}`)} ${clr.error(`-${linesRemoved}`)}`;
  const lines = [truncateToWidth(`       ${summary}`, width)];

  if (metadata.diffSkipped) {
    lines.push(...renderDiffSkipped(metadata.diffReason, width));
    return lines;
  }

  if (metadata.compactDiff && metadata.compactDiff.length > 0) {
    lines.push(SUB_INDENT);
    lines.push(...renderCompactDiffLines(metadata.compactDiff, width));
  } else if (metadata.diff) {
    lines.push(SUB_INDENT);
    lines.push(...renderLegacyDiff(metadata.diff, width));
  } else if (!metadata.created && linesAdded === 0 && linesRemoved === 0) {
    lines.push(truncateToWidth(`       ${clr.dim("no content changes")}`, width));
  }

  return lines;
}

function renderGlobMetadata(metadata: GlobMetadata, width: number): string[] {
  const total = metadata.totalMatches ?? metadata.matchCount;
  const countText = metadata.truncated
    ? `${metadata.matchCount}/${total} matches shown`
    : `${metadata.matchCount} ${pluralize(metadata.matchCount, "match", "matches")}`;
  const path = metadata.path ? `  path ${metadata.path}` : "";
  return [truncateToWidth(`       ${clr.dim("found")} ${countText}  ${clr.dim("pattern")} ${metadata.pattern}${path}`, width)];
}

function renderGrepMetadata(metadata: GrepMetadata, width: number): string[] {
  const countText = `${metadata.matchCount} ${pluralize(metadata.matchCount, "match", "matches")}`;
  const path = metadata.path ? `  path ${metadata.path}` : "";
  const include = metadata.include ? `  include ${metadata.include}` : "";
  const suffix = metadata.truncated ? "  truncated" : "";
  return [truncateToWidth(`       ${clr.dim("found")} ${countText}  ${clr.dim("pattern")} ${metadata.pattern}${path}${include}${suffix}`, width)];
}

function classifyOutcome(result: RenderedResult): Outcome {
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

function outcomeLabel(
  outcome: Outcome,
  toolName: string,
  subagentCodename?: string
): string {
  switch (outcome) {
    case "blocked":
      return clr.dim("[blocked]");
    case "aborted":
      if (toolName === "task") return clr.dim(formatSubagentAbortLabel(subagentCodename));
      return clr.dim("[aborted]");
    default:
      return "";
  }
}

function formatTaskActionLabel(entry: TaskActionEntry | string): string {
  if (typeof entry === "string") return entry;
  return `${entry.label}  ${formatDuration(entry.durationMs)}`;
}

function formatSubagentProgressText(line: SubagentProgressLine): string {
  const duration =
    line.durationMs !== undefined ? `  ${formatDuration(line.durationMs)}` : "";
  return `${line.content}${duration}`;
}

function renderSubagentProgressLines(lines: SubagentProgressLine[], width: number): string[] {
  return lines.flatMap((line) =>
    wrapPrefixed(SUBAGENT_LINE_PREFIX, clr.dim(formatSubagentProgressText(line)), width)
  );
}

function renderTaskActionLines(actions: TaskActionEntry[], width: number, maxRows = 6): string[] {
  const visible = actions.slice(0, maxRows);
  const rendered = visible.flatMap((action) =>
    wrapPrefixed(SUBAGENT_LINE_PREFIX, clr.dim(formatTaskActionLabel(action)), width)
  );
  if (actions.length > maxRows) {
    rendered.push(
      truncateToWidth(`       ${clr.dim(`… ${actions.length - maxRows} more actions`)}`, width)
    );
  }
  return rendered;
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
    const normalized: TaskActionEntry[] = metadata.actions.map((action) =>
      typeof action === "string" ? { label: action, durationMs: 0 } : action
    );
    return renderTaskActionLines(normalized, width);
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
    if (isUserDecisionToolOutput(output)) {
      return [];
    }
    return renderTrimmedOutput(output, width, MAX_OUTPUT_ROWS);
  }

  return [];
}

export class ToolBlock implements Component {
  private state: ToolBlockState;
  private subagentLines: SubagentProgressLine[] = [];

  constructor(name: string, args: Record<string, unknown>, opts?: ToolBlockOptions) {
    const previewTodos = name === "todo_write" ? parseTodosFromArgs(args) : undefined;
    this.state = {
      status: "running",
      name,
      argsSummary: summarizeArgs(name, args),
      ...(opts?.subagentCodename ? { subagentCodename: opts.subagentCodename } : {}),
      ...(previewTodos ? { previewTodos } : {}),
      ...(name === "task" ? { taskStartedAt: Date.now() } : {}),
    };
  }

  appendSubagentLine(line: SubagentProgressLine): void {
    this.subagentLines.push(line);
    if (this.subagentLines.length > 10) {
      this.subagentLines = this.subagentLines.slice(-10);
    }
  }



  setDone(result: RenderedResult, durationMs: number): void {
    const codename =
      this.state.status === "running" ? this.state.subagentCodename : undefined;
    const name = this.state.name;
    let argsSummary = this.state.argsSummary;
    const metadata = asToolMetadata(result.metadata);
    if (metadata && TypeGuards.isTodo(metadata)) {
      argsSummary = summarizeTodoDoneSummary(name, metadata);
    }
    this.state = {
      status: "done",
      name,
      argsSummary,
      ...(codename ? { subagentCodename: codename } : {}),
      result,
      durationMs,
    };
  }

  /** Completed tool row for session replay (no running spinner). */
  static fromCompleted(
    name: string,
    args: Record<string, unknown>,
    result: RenderedResult,
    durationMs = 0
  ): ToolBlock {
    const block = new ToolBlock(name, args);
    block.setDone(result, durationMs);
    return block;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.state;

    const toolLabel = displayToolName(state.name, state.subagentCodename);

    if (state.status === "running") {
      const spinner = clr.running(currentSpinner(state.name));
      const liveElapsed =
        state.name === "task" && state.taskStartedAt !== undefined
          ? `  ${clr.duration(formatDuration(Date.now() - state.taskStartedAt))}`
          : "";
      const lines = [
        truncateToWidth(
          `${GUTTER}${spinner} ${clr.toolName(toolLabel)}  ${clr.args(state.argsSummary)}${liveElapsed}`,
          width
        ),
      ];
      if (state.previewTodos && state.previewTodos.length > 0) {
        lines.push(...renderTodoListFromTodos(state.previewTodos, width));
      }
      if (state.name === "task" && this.subagentLines.length > 0) {
        lines.push(...renderSubagentProgressLines(this.subagentLines, width));
      }
      return lines;
    }

    const outcome = classifyOutcome(state.result);
    const taskAborted = state.name === "task" && outcome === "aborted";
    const icon = taskAborted
      ? clr.dim("✓")
      : outcome === "success"
        ? clr.success("✓")
        : clr.error("✗");
    const label = outcomeLabel(outcome, state.name, state.subagentCodename);
    const duration = clr.duration(formatDuration(state.durationMs));
    const suffix = label.length > 0 ? `  ${label}` : "";
    const lines = [
      truncateToWidth(
        `${GUTTER}${icon} ${clr.toolName(toolLabel)}  ${clr.args(state.argsSummary)}${suffix}  ${duration}`,
        width
      ),
    ];
    const metadata = asToolMetadata(state.result.metadata);
    lines.push(...renderMetadata(metadata, state.result.output, state.result.success, width));
    return lines;
  }
}
