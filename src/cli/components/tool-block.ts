/**
 * ToolBlock — renders a tool call in-place.
 *
 * Running tools animate with lightweight spinners. Completed tools keep a
 * visible summary, while noisy raw output is suppressed unless the tool failed
 * or returns structured metadata worth showing (todos, task actions).
 */

import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER, maxLineWidth, truncateGutterLine } from "../gutter.js";
import { formatDurationBracketed, formatDurationMs } from "../format-helpers.js";

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
  type QuestionMetadata,
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
const MAX_TODO_ROWS = 20;

const TODO_GLYPH_ACTIVE = "◉";
const TODO_GLYPH_PENDING = "○";
const TODO_GLYPH_DONE = "●";
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

export type TodoRenderOptions = {
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

export function shouldCompactToolOutput(
  name: string,
  success: boolean,
  metadata?: Record<string, unknown>
): boolean {
  if (name === "todo_write") {
    return success && metadata?.["unchanged"] === true;
  }
  if (name === "todo_read") return true;
  return success && COMPACT_READONLY_TOOLS.has(name);
}

type TodoPreviewItem = TodoMetadata["todos"][number];

export type TodoWindowSelection = {
  headCollapseLabel?: string;
  visible: TodoPreviewItem[];
  tailHiddenCount: number;
};

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
  if (name === "todo_write" && metadata.unchanged) return "todos unchanged";
  const counts = summarizeTodoCounts(metadata.todos);
  if (name === "todo_write") return `todos updated · ${counts}`;
  if (metadata.total === 0) return "read todos · empty";
  return `read todos · ${counts}`;
}

function questionTopicsFromArgs(args: Record<string, unknown>): string[] {
  const questions = args["questions"];
  if (!Array.isArray(questions)) return [];
  return questions
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return "";
      const topic = (entry as { topic?: string }).topic;
      return typeof topic === "string" ? topic.trim() : "";
    })
    .filter((topic) => topic.length > 0);
}

/** Running row: topic tab names (context stays in the overlay only). */
function summarizeQuestionRunning(args: Record<string, unknown>): string {
  if (!Array.isArray(args["questions"])) {
    return "missing questions array";
  }
  const topics = questionTopicsFromArgs(args);
  if (topics.length === 0) return "empty questions";
  if (topics.length === 1) return topics[0]!;
  return topics.join(" · ");
}

/** Done row: topic → selected answer(s). */
function summarizeQuestionDone(metadata: QuestionMetadata): string {
  const parts = metadata.questions.map((q) => {
    const selected = q.answers.map((a) => a.trim()).filter(Boolean);
    const answer = selected.length > 0 ? selected.join(", ") : "—";
    return `${q.topic}: ${answer}`;
  });
  return parts.length > 0 ? parts.join(" · ") : "answered";
}

function stripAnsiForWrap(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Collapse control chars / newlines so tool row titles stay single-logical-line for pi-tui. */
function sanitizeToolArgText(text: string): string {
  return stripAnsiForWrap(text)
    .replace(/\r\n/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "question") {
    return summarizeQuestionRunning(args);
  }

  if (name === "todo_write" || name === "todo_read") {
    return summarizeTodoArgs(name, args);
  }

  if (name === "task") {
    const description = typeof args["description"] === "string" ? String(args["description"]) : "delegating subagent task";
    return description;
  }

  if (name === "glob") {
    const pattern = typeof args["pattern"] === "string" ? String(args["pattern"]) : "pattern";
    const path = typeof args["path"] === "string" ? ` in ${String(args["path"])}` : "";
    return `${pattern}${path}`;
  }

  if (name === "grep") {
    const pattern = typeof args["pattern"] === "string" ? String(args["pattern"]) : "pattern";
    const path = typeof args["path"] === "string" ? ` in ${String(args["path"])}` : "";
    const include = typeof args["include"] === "string" ? ` (${String(args["include"])})` : "";
    return `${pattern}${path}${include}`;
  }

  const keys = ["path", "filePath", "file", "command", "pattern", "query", "description", "prompt", "url"];
  for (const key of keys) {
    if (typeof args[key] === "string") {
      return sanitizeToolArgText(String(args[key]));
    }
  }

  return Object.entries(args)
    .slice(0, 1)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("");
}

function asToolMetadata(value: Record<string, unknown> | undefined): ToolMetadata | null {
  if (!value || typeof value["type"] !== "string") return null;
  return value as unknown as ToolMetadata;
}

export function isSilentUnchangedTodoWrite(
  name: string,
  result: { metadata?: Record<string, unknown> }
): boolean {
  if (name !== "todo_write") return false;
  const metadata = asToolMetadata(result.metadata);
  return metadata !== null && TypeGuards.isTodo(metadata) && metadata.unchanged === true;
}

export function isCosmeticTodoRewrite(
  name: string,
  result: { metadata?: Record<string, unknown> }
): boolean {
  if (name !== "todo_write") return false;
  const metadata = asToolMetadata(result.metadata);
  return metadata !== null && TypeGuards.isTodo(metadata) && metadata.cosmetic === true;
}

function wrapPrefixed(prefix: string, text: string, width: number): string[] {
  const available = Math.max(8, maxLineWidth(width) - visibleWidth(prefix));
  const wrapped = wrapTextWithAnsi(text.length > 0 ? text : " ", available);
  return wrapped.map((line, i) => {
    const p = i === 0 ? prefix : SUB_INDENT;
    return truncateGutterLine(`${p}${line}`, width);
  });
}

function formatToolDuration(durationMs: number): string {
  return clr.duration(formatDurationBracketed(durationMs));
}

function appendSummaryTail(lines: string[], tail: string, width: number): void {
  if (!tail) return;
  if (lines.length === 0) {
    lines.push(truncateGutterLine(`${GUTTER}${tail.trimStart()}`, width));
    return;
  }
  const lastIdx = lines.length - 1;
  const last = lines[lastIdx]!;
  const candidate = `${last}${tail}`;
  if (visibleWidth(candidate) <= maxLineWidth(width)) {
    lines[lastIdx] = truncateGutterLine(candidate, width);
    return;
  }
  lines.push(truncateGutterLine(`${SUB_INDENT}${tail.trimStart()}`, width));
}

/** Tool header row: wrap args; tail (duration) on the last summary line. */
function wrapToolSummaryLine(
  prefix: string,
  args: string,
  width: number,
  suffix = ""
): string[] {
  const bodyAvail = Math.max(8, maxLineWidth(width) - visibleWidth(prefix));
  const wrapped = wrapTextWithAnsi(args.length > 0 ? args : " ", bodyAvail);
  const lines: string[] = [];
  if (wrapped.length === 0) {
    lines.push(truncateGutterLine(`${prefix}${clr.args(" ")}`, width));
  } else {
    lines.push(truncateGutterLine(`${prefix}${clr.args(wrapped[0]!)}`, width));
    const contAvail = Math.max(8, maxLineWidth(width) - visibleWidth(SUB_INDENT));
    for (let i = 1; i < wrapped.length; i++) {
      for (const sub of wrapTextWithAnsi(wrapped[i]!, contAvail)) {
        lines.push(truncateGutterLine(`${SUB_INDENT}${clr.args(sub)}`, width));
      }
    }
  }
  appendSummaryTail(lines, suffix, width);
  return lines;
}

function wrapCompactToolLine(
  verb: string,
  args: string,
  width: number,
  suffix = ""
): string[] {
  const prefix = `${GUTTER}${clr.dim("·")} ${clr.dim(verb)} `;
  return wrapToolSummaryLine(prefix, args, width, suffix);
}

function renderTrimmedOutput(output: string, width: number, maxRows: number): string[] {
  const normalized = stripAnsiForWrap(output.replace(/\r\n/g, "\n").replace(/\r/g, "\n")).trimEnd();
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

export function formatTodoLine(
  todo: TodoMetadata["todos"][number],
  _opts?: TodoRenderOptions
): string {
  switch (todo.status) {
    case "in_progress":
      return `${TODO_GLYPH_ACTIVE} ${todo.content}`;
    case "completed":
      return `${clr.dim(TODO_GLYPH_DONE)} ${c.dim}${c.strike}${todo.content}${c.reset}`;
    case "cancelled":
      return `${clr.dim(TODO_GLYPH_PENDING)} ${c.dim}${c.strike}${todo.content}${c.reset}`;
    default:
      return `${clr.pending(TODO_GLYPH_PENDING)} ${todo.content}`;
  }
}

/** Pick visible todo rows anchored on the in-progress item (or first pending / all-done tail). */
export function selectTodoWindow(
  todos: TodoPreviewItem[],
  maxRows: number = MAX_TODO_ROWS
): TodoWindowSelection {
  if (todos.length === 0) {
    return { visible: [], tailHiddenCount: 0 };
  }

  let anchorIdx = todos.findIndex((todo) => todo.status === "in_progress");
  if (anchorIdx < 0) {
    anchorIdx = todos.findIndex((todo) => todo.status === "pending");
  }

  if (anchorIdx < 0) {
    if (todos.length <= 2) {
      return { visible: todos, tailHiddenCount: 0 };
    }
    const hiddenDone = todos.length - 2;
    return {
      headCollapseLabel: `… ${hiddenDone} done`,
      visible: todos.slice(-2),
      tailHiddenCount: 0,
    };
  }

  const contextStart = Math.max(0, anchorIdx - 1);
  const hiddenBeforeContext = contextStart;

  let headCollapseLabel: string | undefined;
  if (hiddenBeforeContext > 0) {
    const hiddenItems = todos.slice(0, hiddenBeforeContext);
    const allDoneOrCancelled = hiddenItems.every(
      (todo) => todo.status === "completed" || todo.status === "cancelled"
    );
    headCollapseLabel = allDoneOrCancelled
      ? `… ${hiddenBeforeContext} done`
      : `… ${hiddenBeforeContext} earlier`;
  }

  const available = todos.slice(contextStart);
  if (available.length <= maxRows) {
    return headCollapseLabel !== undefined
      ? { headCollapseLabel, visible: available, tailHiddenCount: 0 }
      : { visible: available, tailHiddenCount: 0 };
  }

  const tailHiddenCount = available.length - maxRows;
  return headCollapseLabel !== undefined
    ? {
        headCollapseLabel,
        visible: available.slice(0, maxRows),
        tailHiddenCount,
      }
    : {
        visible: available.slice(0, maxRows),
        tailHiddenCount,
      };
}

function renderTodoListFromTodos(
  todos: TodoPreviewItem[],
  width: number,
  opts?: TodoRenderOptions
): string[] {
  const { headCollapseLabel, visible, tailHiddenCount } = selectTodoWindow(todos, MAX_TODO_ROWS);
  const lines: string[] = [];

  if (headCollapseLabel) {
    lines.push(truncateGutterLine(`       ${clr.dim(headCollapseLabel)}`, width));
  }

  for (const todo of visible) {
    lines.push(
      ...wrapPrefixed(
        SUB_INDENT,
        formatTodoLine(todo, opts),
        width
      )
    );
  }

  if (tailHiddenCount > 0) {
    const label =
      tailHiddenCount === 1
        ? "(1 additional task)"
        : `(${tailHiddenCount} additional tasks)`;
    lines.push(truncateGutterLine(`       ${clr.dim(label)}`, width));
  }

  return lines;
}

function renderTodoList(
  metadata: TodoMetadata,
  width: number,
  opts?: TodoRenderOptions
): string[] {
  return renderTodoListFromTodos(metadata.todos, width, opts);
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

function appendDiffTruncatedFooter(
  lines: string[],
  metadata: FileEditMetadata | FileWriteMetadata,
  width: number
): void {
  if (metadata.diffTruncatedLines && metadata.diffTruncatedLines > 0) {
    lines.push(
      truncateGutterLine(
        `       ${clr.dim(`… ${metadata.diffTruncatedLines} more lines`)}`,
        width
      )
    );
  }
}

function renderFileEditMetadata(
  metadata: FileEditMetadata,
  width: number,
  maxDiffLines?: number
): string[] {
  const replacements = metadata.replacements ?? 1;
  const summaryLine = truncateGutterLine(
    `       ${clr.dim("~")} ${clr.dim(`${replacements} ${pluralize(replacements, "replacement")},`)} ${clr.success(`+${metadata.linesAdded}`)} ${clr.error(`-${metadata.linesRemoved}`)}`,
    width,
  );

  if (metadata.diffSkipped) {
    const lines: string[] = [];
    if (metadata.linesAdded > 0 || metadata.linesRemoved > 0) {
      lines.push(summaryLine);
    }
    lines.push(...renderDiffSkipped(metadata.diffReason, width));
    return lines;
  }

  const lines = [summaryLine];

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
      appendDiffTruncatedFooter(lines, metadata, width);
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
      appendDiffTruncatedFooter(lines, metadata, width);
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
  toolName?: string,
  todoRenderOpts?: TodoRenderOptions
): string[] {
  if (metadata && TypeGuards.isTodo(metadata)) {
    return renderTodoList(metadata, width, todoRenderOpts);
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

  isTodoTool(): boolean {
    return this.state.name === "todo_write" || this.state.name === "todo_read";
  }

  private getTodoRenderOpts(): TodoRenderOptions {
    return {};
  }

  isSilentUnchangedTodo(): boolean {
    if (this.state.status !== "done") return false;
    return isSilentUnchangedTodoWrite(this.state.name, this.state.result);
  }

  isRevealing(): boolean {
    return this.state.status === "revealing";
  }

  /** True when the block renders body lines beyond the summary row (diff, todos, errors). */
  hasExpandedBody(): boolean {
    const state = this.state;
    if (state.status === "revealing") return true;
    if (state.status === "running") {
      return !!(
        (state.previewTodos && state.previewTodos.length > 0) ||
        (state.name === "task" && this.subagentLines.length > 0)
      );
    }
    if (state.status !== "done") return false;
    if (state.compact && !state.userExpanded && classifyOutcome(state.result) === "success") {
      return false;
    }
    if (state.collapsed) return false;
    const metadata = asToolMetadata(state.result.metadata);
    if (metadata && TypeGuards.isTodo(metadata)) {
      return metadata.unchanged !== true;
    }
    if (metadata && (TypeGuards.isFileEdit(metadata) || TypeGuards.isFileWrite(metadata))) {
      return true;
    }
    if (!state.result.success && state.result.output.trim().length > 0) return true;
    const bodyLines = renderMetadata(
      metadata,
      state.result.output,
      state.result.success,
      120,
      undefined,
      state.name
    );
    return bodyLines.length > 0;
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
    } else if (metadata && TypeGuards.isQuestion(metadata)) {
      argsSummary = summarizeQuestionDone(metadata);
    } else if (name === "question" && result.success) {
      argsSummary = "answered";
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
    if (this.isSilentUnchangedTodo()) {
      return [];
    }

    const state = this.state;
    const todoRenderOpts = this.getTodoRenderOpts();

    const toolLabel = displayToolName(state.name, state.subagentCodename);

    if (state.status === "revealing") {
      const outcome = classifyOutcome(state.result);
      const taskAborted = state.name === "task" && outcome === "aborted";
      const icon = taskAborted
        ? clr.dim("✓")
        : outcome === "success"
          ? clr.success("✓")
          : clr.error("✗");
      const duration = formatToolDuration(state.durationMs);
      const revealLabel = displayToolName(state.name, state.subagentCodename);
      const lines = wrapToolSummaryLine(
        `${GUTTER}${icon} ${clr.toolName(revealLabel)}  `,
        state.argsSummary,
        width,
        `  ${duration}`
      );
      const metadata = asToolMetadata(state.result.metadata);
      lines.push(
        ...renderMetadata(
          metadata,
          state.result.output,
          state.result.success,
          width,
          state.revealedCount,
          state.name,
          todoRenderOpts
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
            ? `  ${formatToolDuration(Date.now() - runningState.taskStartedAt)}`
            : "";
      const lines = wrapToolSummaryLine(
        `${GUTTER}${spinner} ${clr.toolName(toolLabel)}  `,
        runningState.argsSummary,
        width,
        taskSuffix
      );
      if (runningState.previewTodos && runningState.previewTodos.length > 0) {
        lines.push(...renderTodoListFromTodos(runningState.previewTodos, width, todoRenderOpts));
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
        const prefix = `${GUTTER}${icon} ${clr.toolName(toolLabel)}  `;
        return wrapToolSummaryLine(prefix, state.argsSummary, width);
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
      return wrapCompactToolLine(
        verb,
        state.argsSummary,
        width,
        `  ${formatToolDuration(state.durationMs)}`
      );
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
      const duration = formatToolDuration(state.durationMs);
      const suffix = label.length > 0 ? `  ${label}` : "";
      const rowLabel = displayToolName(state.name, state.subagentCodename);
      const prefix = `${GUTTER}${icon} ${clr.toolName(rowLabel)}  `;
      const tail = `${suffix}  ${duration}`;
      return wrapToolSummaryLine(prefix, state.argsSummary, width, tail);
    }

    const outcome = classifyOutcome(state.result);
    const taskAborted = state.name === "task" && outcome === "aborted";
    const icon = taskAborted
      ? clr.dim("✓")
      : outcome === "success"
        ? clr.success("✓")
        : clr.error("✗");
    const label = outcomeLabel(outcome, state.name, state.subagentCodename);
    const duration = formatToolDuration(state.durationMs);
    const suffix = label.length > 0 ? `  ${label}` : "";
    const prefix = `${GUTTER}${icon} ${clr.toolName(toolLabel)}  `;
    const tail = `${suffix}  ${duration}`;
    const lines = wrapToolSummaryLine(prefix, state.argsSummary, width, tail);
    const metadata = asToolMetadata(state.result.metadata);
    lines.push(
      ...renderMetadata(
        metadata,
        state.result.output,
        state.result.success,
        width,
        undefined,
        state.name,
        todoRenderOpts
      )
    );
    return lines;
  }
}
