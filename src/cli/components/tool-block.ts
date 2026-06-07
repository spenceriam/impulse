/**
 * ToolBlock — renders a tool call in-place.
 *
 * Running tools animate with lightweight spinners. Completed tools keep a
 * visible summary, while noisy raw output is suppressed unless the tool failed
 * or returns structured metadata worth showing (todos, task actions).
 */

import { wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER, maxLineWidth, truncateGutterLine } from "../gutter.js";
import { formatDurationMs } from "../format-helpers.js";

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
const BASH_MAX_OUTPUT_ROWS = 100;
const MAX_TODO_ROWS = 12;
const DIFF_REVEAL_LINES_PER_TICK = 2;

export const DIFF_REVEAL_TICK_MS = 25;

type RenderedResult = {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
};

export type ToolBlockOptions = {
  subagentCodename?: string;
};

export type ToolBlockDoneOptions = {
  collapsed?: boolean;
  /** Dim one-liner for read-only tools; expand on toggle. */
  compact?: boolean;
};

/** Read-only tools that default to a dim collapsed row on success. */
const COMPACT_READONLY_TOOLS = new Set([
  "file_read",
  "glob",
  "grep",
  "web_search",
  "web_fetch",
  "bash",
]);

export function shouldCompactToolOutput(name: string, success: boolean): boolean {
  if (name === "todo_write") return false;
  if (name === "todo_read") return true;
  return success && COMPACT_READONLY_TOOLS.has(name);
}

type TodoPreviewItem = TodoMetadata["todos"][number];

export type ToolBlockState =
  | {
      status: "running";
      name: string;
      argsSummary: string;
      subagentCodename?: string;
      previewTodos?: TodoPreviewItem[];
      taskPhase?: "queued" | "active";
      taskStartedAt?: number;
      taskRowCreatedAt?: number;
    }
  | {
      status: "revealing";
      name: string;
      argsSummary: string;
      subagentCodename?: string;
      result: RenderedResult;
      durationMs: number;
      diffLines: string[];
      revealedCount: number;
    }
  | {
      status: "done";
      name: string;
      argsSummary: string;
      subagentCodename?: string;
      result: RenderedResult;
      durationMs: number;
      collapsed?: boolean;
      compact?: boolean;
      userExpanded?: boolean;
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
  type: "text" | "tool" | "thinking" | "status";
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
  const available = Math.max(8, maxLineWidth(width) - prefix.length);
  const wrapped = wrapTextWithAnsi(text.length > 0 ? text : " ", available);
  return wrapped.map((line) => truncateGutterLine(`${prefix}${line}`, width));
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
    truncateGutterLine(`       ${clr.dim(`… ${hidden} more lines`)}`, width),
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
    lines.push(truncateGutterLine(`       ${clr.dim(`… ${todos.length - MAX_TODO_ROWS} more items`)}`, width));
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
    return truncateGutterLine(`       ${colorCompactDiffLine(line)}`, width);
  });

  if (diffLines.length > maxRows) {
    visible.push(truncateGutterLine(`       ${clr.dim(`… ${diffLines.length - maxRows} more diff lines`)}`, width));
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
  return [truncateGutterLine(`       ${clr.dim(`diff skipped: ${reason ?? "not available"}`)}`, width)];
}

function renderFileEditMetadata(
  metadata: FileEditMetadata,
  width: number,
  maxDiffLines?: number
): string[] {
  if (metadata.diffSkipped) {
    return renderDiffSkipped(metadata.diffReason, width);
  }

  const replacements = metadata.replacements ?? 1;
  const lines = [
    truncateGutterLine(
      `       ${clr.dim("~")} ${clr.dim(`${replacements} ${pluralize(replacements, "replacement")},`)} ${clr.success(`+${metadata.linesAdded}`)} ${clr.error(`-${metadata.linesRemoved}`)}`,
      width,
    ),
  ];

  if (metadata.compactDiff && metadata.compactDiff.length > 0) {
    if (maxDiffLines === undefined || maxDiffLines > 0) {
      lines.push(SUB_INDENT);
      const diffSource =
        maxDiffLines !== undefined
          ? metadata.compactDiff.slice(0, maxDiffLines)
          : metadata.compactDiff;
      lines.push(...renderCompactDiffLines(diffSource, width));
      if (maxDiffLines !== undefined && maxDiffLines < metadata.compactDiff.length) {
        lines.push(
          truncateGutterLine(
            `       ${clr.dim(`… ${metadata.compactDiff.length - maxDiffLines} more diff lines`)}`,
            width
          )
        );
      }
    }
  } else if (metadata.diff) {
    lines.push(SUB_INDENT);
    lines.push(...renderLegacyDiff(metadata.diff, width));
  } else {
    lines.push(truncateGutterLine(`       ${clr.dim("no visible diff")}`, width));
  }

  return lines;
}

function renderFileWriteMetadata(
  metadata: FileWriteMetadata,
  width: number,
  maxDiffLines?: number
): string[] {
  const linesAdded = metadata.linesAdded ?? 0;
  const linesRemoved = metadata.linesRemoved ?? 0;
  const summary = metadata.created
    ? `${clr.success("+")} ${clr.success(`${metadata.linesWritten} ${pluralize(metadata.linesWritten, "line")} created`)}`
    : `${clr.dim("~")} ${clr.dim("overwritten,")} ${clr.success(`+${linesAdded}`)} ${clr.error(`-${linesRemoved}`)}`;
  const lines = [truncateGutterLine(`       ${summary}`, width)];

  if (metadata.diffSkipped) {
    lines.push(...renderDiffSkipped(metadata.diffReason, width));
    return lines;
  }

  if (metadata.compactDiff && metadata.compactDiff.length > 0) {
    if (maxDiffLines === undefined || maxDiffLines > 0) {
      lines.push(SUB_INDENT);
      const diffSource =
        maxDiffLines !== undefined
          ? metadata.compactDiff.slice(0, maxDiffLines)
          : metadata.compactDiff;
      lines.push(...renderCompactDiffLines(diffSource, width));
      if (maxDiffLines !== undefined && maxDiffLines < metadata.compactDiff.length) {
        lines.push(
          truncateGutterLine(
            `       ${clr.dim(`… ${metadata.compactDiff.length - maxDiffLines} more diff lines`)}`,
            width
          )
        );
      }
    }
  } else if (metadata.diff) {
    lines.push(SUB_INDENT);
    lines.push(...renderLegacyDiff(metadata.diff, width));
  } else if (!metadata.created && linesAdded === 0 && linesRemoved === 0) {
    lines.push(truncateGutterLine(`       ${clr.dim("no content changes")}`, width));
  }

  return lines;
}

function renderGlobMetadata(metadata: GlobMetadata, width: number): string[] {
  const total = metadata.totalMatches ?? metadata.matchCount;
  const countText = metadata.truncated
    ? `${metadata.matchCount}/${total} matches shown`
    : `${metadata.matchCount} ${pluralize(metadata.matchCount, "match", "matches")}`;
  const path = metadata.path ? `  path ${metadata.path}` : "";
  return [truncateGutterLine(`       ${clr.dim("found")} ${countText}  ${clr.dim("pattern")} ${metadata.pattern}${path}`, width)];
}

function renderGrepMetadata(metadata: GrepMetadata, width: number): string[] {
  const countText = `${metadata.matchCount} ${pluralize(metadata.matchCount, "match", "matches")}`;
  const path = metadata.path ? `  path ${metadata.path}` : "";
  const include = metadata.include ? `  include ${metadata.include}` : "";
  const suffix = metadata.truncated ? "  truncated" : "";
  return [truncateGutterLine(`       ${clr.dim("found")} ${countText}  ${clr.dim("pattern")} ${metadata.pattern}${path}${include}${suffix}`, width)];
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
  return `${entry.label}  ${formatDurationMs(entry.durationMs)}`;
}

function formatSubagentProgressText(line: SubagentProgressLine): string {
  if (line.type === "thinking" || line.type === "status") {
    return line.content;
  }
  const duration =
    line.durationMs !== undefined ? `  ${formatDurationMs(line.durationMs)}` : "";
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
      truncateGutterLine(`       ${clr.dim(`… ${actions.length - maxRows} more actions`)}`, width)
    );
  }
  return rendered;
}

const QUEUED_TASK_SPINNER = TOOL_SPINNER[0] ?? "··●";

/** Spinner frame for a tool row; optional epoch anchors animation start (task rows). */
export function currentSpinnerFrame(name: string, epochMs?: number): string {
  const frames = name === "question" ? QUESTION_SPINNER : TOOL_SPINNER;
  const frameMs = name === "question" ? QUESTION_FRAME_MS : TOOL_FRAME_MS;
  const index =
    epochMs !== undefined
      ? Math.floor((Date.now() - epochMs) / frameMs) % frames.length
      : Math.floor(Date.now() / frameMs) % frames.length;
  return frames[index] ?? frames[0] ?? "...";
}

export function extractDiffLinesFromMetadata(
  metadata: Record<string, unknown> | undefined
): string[] {
  const parsed = asToolMetadata(metadata);
  if (!parsed) return [];

  if (TypeGuards.isFileEdit(parsed)) {
    if (parsed.diffSkipped) return [];
    if (parsed.compactDiff && parsed.compactDiff.length > 0) return parsed.compactDiff;
    if (parsed.diff) {
      return parsed.diff
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .filter((line) => {
          if (line.startsWith("Index:")) return false;
          if (line.startsWith("===") || line.startsWith("---") || line.startsWith("+++")) {
            return false;
          }
          return line.length > 0;
        });
    }
    return [];
  }

  if (TypeGuards.isFileWrite(parsed)) {
    if (parsed.diffSkipped) return [];
    if (parsed.compactDiff && parsed.compactDiff.length > 0) return parsed.compactDiff;
    if (parsed.diff) {
      return parsed.diff
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .filter((line) => line.length > 0);
    }
  }

  return [];
}

function renderMetadata(
  metadata: ToolMetadata | null,
  output: string,
  success: boolean,
  width: number,
  maxDiffLines?: number,
  toolName?: string
): string[] {
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
    return renderFileEditMetadata(metadata, width, maxDiffLines);
  }

  if (success && metadata && TypeGuards.isFileWrite(metadata)) {
    return renderFileWriteMetadata(metadata, width, maxDiffLines);
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
    const maxRows = toolName === "bash" ? BASH_MAX_OUTPUT_ROWS : MAX_OUTPUT_ROWS;
    return renderTrimmedOutput(output, width, maxRows);
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
      ...(name === "task"
        ? { taskPhase: "queued" as const, taskRowCreatedAt: Date.now() }
        : {}),
    };
  }

  /** Elapsed ms for a running task row (active work or time since row appeared). */
  getElapsedMs(): number {
    if (this.state.status !== "running" || this.state.name !== "task") return 0;
    if (this.state.taskPhase === "active" && this.state.taskStartedAt !== undefined) {
      return Date.now() - this.state.taskStartedAt;
    }
    if (this.state.taskRowCreatedAt !== undefined) {
      return Date.now() - this.state.taskRowCreatedAt;
    }
    return 0;
  }

  setSubagentTaskStatus(status: "queued" | "running" | "done"): void {
    if (this.state.status !== "running" || this.state.name !== "task") return;

    if (status === "queued") {
      const { taskStartedAt: _dropped, ...rest } = this.state;
      this.state = { ...rest, taskPhase: "queued" };
      return;
    }
    if (status === "running") {
      this.markTaskActive();
      return;
    }
  }

  markTaskActive(): void {
    if (this.state.status !== "running" || this.state.name !== "task") return;
    this.state = {
      ...this.state,
      taskPhase: "active",
      taskStartedAt: Date.now(),
    };
  }

  appendSubagentLine(line: SubagentProgressLine): void {
    const last = this.subagentLines[this.subagentLines.length - 1];
    if (
      line.type === "status" &&
      line.content.startsWith("Thought for") &&
      last?.type === "thinking"
    ) {
      this.subagentLines[this.subagentLines.length - 1] = line;
      return;
    }

    this.subagentLines.push(line);
    if (this.subagentLines.length > 10) {
      this.subagentLines = this.subagentLines.slice(-10);
    }
  }



  getToolName(): string {
    return this.state.name;
  }

  isRunning(): boolean {
    return this.state.status === "running" || this.state.status === "revealing";
  }

  isRevealing(): boolean {
    return this.state.status === "revealing";
  }

  setDone(result: RenderedResult, durationMs: number, opts?: ToolBlockDoneOptions): void {
    const prior =
      this.state.status === "running" || this.state.status === "revealing"
        ? this.state
        : null;
    const codename = prior?.subagentCodename;
    const name = prior?.name ?? this.state.name;
    let argsSummary = prior?.argsSummary ?? this.state.argsSummary;
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
      ...(opts?.collapsed ? { collapsed: true } : {}),
      ...(opts?.compact ? { compact: true, userExpanded: false } : {}),
    };
  }

  toggleExpanded(): boolean {
    if (this.state.status !== "done" || !this.state.compact) return false;
    this.state = { ...this.state, userExpanded: !this.state.userExpanded };
    return true;
  }

  isCompactCollapsed(): boolean {
    return (
      this.state.status === "done" &&
      this.state.compact === true &&
      this.state.userExpanded !== true
    );
  }

  beginDiffReveal(result: RenderedResult, durationMs: number, opts?: ToolBlockDoneOptions): boolean {
    const diffLines = extractDiffLinesFromMetadata(result.metadata);
    if (diffLines.length === 0) {
      this.setDone(result, durationMs, opts);
      return false;
    }

    const prior = this.state.status === "running" ? this.state : null;

    this.state = {
      status: "revealing",
      name: prior?.name ?? this.state.name,
      argsSummary: prior?.argsSummary ?? this.state.argsSummary,
      ...(prior?.subagentCodename ? { subagentCodename: prior.subagentCodename } : {}),
      result,
      durationMs,
      diffLines,
      revealedCount: 0,
    };
    void opts;
    return true;
  }

  /** Advance diff reveal; returns true when fully transitioned to done. */
  tickDiffReveal(opts?: ToolBlockDoneOptions): boolean {
    if (this.state.status !== "revealing") return true;

    const nextCount = Math.min(
      this.state.diffLines.length,
      this.state.revealedCount + DIFF_REVEAL_LINES_PER_TICK
    );

    if (nextCount < this.state.diffLines.length) {
      this.state = { ...this.state, revealedCount: nextCount };
      return false;
    }

    this.setDone(this.state.result, this.state.durationMs, opts);
    return true;
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

    if (state.status === "revealing") {
      const outcome = classifyOutcome(state.result);
      const taskAborted = state.name === "task" && outcome === "aborted";
      const icon = taskAborted
        ? clr.dim("✓")
        : outcome === "success"
          ? clr.success("✓")
          : clr.error("✗");
      const duration = clr.duration(formatDurationMs(state.durationMs));
      const revealLabel = displayToolName(state.name, state.subagentCodename);
      const lines = [
        truncateGutterLine(
          `${GUTTER}${icon} ${clr.toolName(revealLabel)}  ${clr.args(state.argsSummary)}  ${duration}`,
          width
        ),
      ];
      const metadata = asToolMetadata(state.result.metadata);
      lines.push(
        ...renderMetadata(
          metadata,
          state.result.output,
          state.result.success,
          width,
          state.revealedCount,
          state.name
        )
      );
      return lines;
    }

    if (state.status === "running") {
      const runningState = state;
      const spinner =
        runningState.name === "task" && runningState.taskPhase === "queued"
          ? clr.dim(QUEUED_TASK_SPINNER)
          : runningState.name === "task" && runningState.taskStartedAt !== undefined
            ? clr.running(currentSpinnerFrame("task", runningState.taskStartedAt))
            : clr.running(currentSpinnerFrame(runningState.name));
      const taskSuffix =
        runningState.name === "task" && runningState.taskPhase === "queued"
          ? `  ${clr.dim("queued")}`
          : runningState.name === "task" && runningState.taskStartedAt !== undefined
            ? `  ${clr.duration(formatDurationMs(Date.now() - runningState.taskStartedAt))}`
            : "";
      const lines = [
        truncateGutterLine(
          `${GUTTER}${spinner} ${clr.toolName(toolLabel)}  ${clr.args(runningState.argsSummary)}${taskSuffix}`,
          width
        ),
      ];
      if (runningState.previewTodos && runningState.previewTodos.length > 0) {
        lines.push(...renderTodoListFromTodos(runningState.previewTodos, width));
      }
      if (runningState.name === "task" && this.subagentLines.length > 0) {
        lines.push(...renderSubagentProgressLines(this.subagentLines, width));
      }
      return lines;
    }

    if (state.status === "done" && state.compact && !state.userExpanded) {
      const outcome = classifyOutcome(state.result);
      if (outcome !== "success") {
        const icon = clr.error("✗");
        return [
          truncateGutterLine(
            `${GUTTER}${icon} ${clr.toolName(toolLabel)}  ${clr.args(state.argsSummary)}`,
            width
          ),
        ];
      }
      const verb =
        state.name === "file_read"
          ? "read"
          : state.name === "glob"
            ? "glob"
            : state.name === "grep"
              ? "grep"
              : state.name === "web_search"
                ? "search"
                : state.name === "web_fetch"
                  ? "fetch"
                  : state.name === "bash"
                    ? "bash"
                    : state.name === "todo_read"
                      ? "todos"
                      : state.name;
      return [
        truncateGutterLine(
          `${GUTTER}${clr.dim("·")} ${clr.dim(verb)} ${clr.args(state.argsSummary)}`,
          width
        ),
      ];
    }

    if (state.status === "done" && state.collapsed) {
      const outcome = classifyOutcome(state.result);
      const taskAborted = state.name === "task" && outcome === "aborted";
      const icon = taskAborted
        ? clr.dim("✓")
        : outcome === "success"
          ? clr.success("✓")
          : clr.error("✗");
      const label = outcomeLabel(outcome, state.name, state.subagentCodename);
      const duration = clr.duration(formatDurationMs(state.durationMs));
      const suffix = label.length > 0 ? `  ${label}` : "";
      return [
        truncateGutterLine(
          `${GUTTER}${icon} ${clr.toolName(displayToolName(state.name, state.subagentCodename))}  ${clr.args(state.argsSummary)}${suffix}  ${duration}`,
          width
        ),
      ];
    }

    const outcome = classifyOutcome(state.result);
    const taskAborted = state.name === "task" && outcome === "aborted";
    const icon = taskAborted
      ? clr.dim("✓")
      : outcome === "success"
        ? clr.success("✓")
        : clr.error("✗");
    const label = outcomeLabel(outcome, state.name, state.subagentCodename);
    const duration = clr.duration(formatDurationMs(state.durationMs));
    const suffix = label.length > 0 ? `  ${label}` : "";
    const lines = [
      truncateGutterLine(
        `${GUTTER}${icon} ${clr.toolName(toolLabel)}  ${clr.args(state.argsSummary)}${suffix}  ${duration}`,
        width
      ),
    ];
    const metadata = asToolMetadata(state.result.metadata);
    lines.push(
      ...renderMetadata(
        metadata,
        state.result.output,
        state.result.success,
        width,
        undefined,
        state.name
      )
    );
    return lines;
  }
}
