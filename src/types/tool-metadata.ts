/**
 * Tool Metadata Types
 * Structured data returned by tools for enhanced UI display
 * 
 * Each tool returns metadata with a discriminated union type field
 * to enable type-safe rendering in the UI.
 */

// ============================================
// Bash Tool Metadata
// ============================================
export interface BashMetadata {
  type: "bash";
  command: string;           // The full command executed
  description?: string;      // Description from tool args
  output: string;            // Combined stdout + stderr
  exitCode: number;          // Process exit code (0 = success)
  truncated: boolean;        // True if output exceeded limit
  workdir?: string;          // Working directory if specified
}

// ============================================
// File Write Tool Metadata
// ============================================
export interface FileWriteMetadata {
  type: "file_write";
  filePath: string;          // Absolute or relative path
  linesWritten: number;      // Number of lines in content
  created: boolean;          // True if file was created (vs overwritten)
  diff?: string;             // Unified diff (for overwrite) or content preview (for new file)
  compactDiff?: string[];    // Compact line-numbered diff lines for terminal rendering
  linesAdded?: number;       // Count of added lines in compact diff
  linesRemoved?: number;     // Count of removed lines in compact diff
  firstChangedLine?: number; // First changed line in the new file
  diffSkipped?: boolean;     // True if diff was skipped due to size
  diffReason?: string;       // Reason diff was skipped
  /** Number of compactDiff lines dropped due to metadata size cap. */
  diffTruncatedLines?: number;
}

// ============================================
// File Edit Tool Metadata
// ============================================
export interface FileEditMetadata {
  type: "file_edit";
  filePath: string;          // Absolute or relative path
  diff: string;              // Unified diff format string
  compactDiff?: string[];    // Compact line-numbered diff lines for terminal rendering
  linesAdded: number;        // Count of added lines in compact diff
  linesRemoved: number;      // Count of removed lines in compact diff
  replacements?: number;     // Number of replacements applied
  firstChangedLine?: number; // First changed line in the new file
  diffSkipped?: boolean;     // True if diff was skipped due to size
  diffReason?: string;       // Reason diff was skipped
  /** Number of compactDiff lines dropped due to metadata size cap. */
  diffTruncatedLines?: number;
}

// ============================================
// File Read Tool Metadata
// ============================================
export interface FileReadMetadata {
  type: "file_read";
  filePath: string;          // Absolute or relative path
  linesRead: number;         // Number of lines returned
  truncated: boolean;        // True if content was truncated
}

// ============================================
// Glob Tool Metadata
// ============================================
export interface GlobMetadata {
  type: "glob";
  pattern: string;           // Glob pattern used
  path?: string;             // Search root path if specified
  matchCount: number;        // Number of files matched after result limiting
  totalMatches?: number;     // Total matches before limiting
  truncated?: boolean;       // True if output was limited
}

// ============================================
// Grep Tool Metadata
// ============================================
export interface GrepMetadata {
  type: "grep";
  pattern: string;           // Regex pattern searched
  path?: string;             // Search root path
  include?: string;          // Include glob if specified
  matchCount: number;        // Number of matches found
  truncated?: boolean;       // True if output was limited
}

// ============================================
// Task (Subagent) Tool Metadata
// ============================================
export interface TaskActionEntry {
  label: string;
  durationMs: number;
}

export interface TaskMetadata {
  type: "task";
  subagentType: string;      // "explore" | "general"
  description: string;       // Task description
  actions: TaskActionEntry[];
  toolCallCount: number;     // Total tool calls made by subagent
}

// ============================================
// Todo Tool Metadata
// ============================================
export interface TodoMetadata {
  type: "todo";
  source: "read" | "write";
  /** True when todo_write received an identical list — no write performed. */
  unchanged?: boolean;
  /** True when todo_write only relabeled/reworded items (same statuses) — UI updates in place. */
  cosmetic?: boolean;
  todos: Array<{
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    priority: "high" | "medium" | "low";
  }>;
  total: number;
  remaining: number;
}

// ============================================
// Question Tool Metadata
// ============================================
export interface QuestionMetadata {
  type: "question";
  context?: string;
  questions: Array<{
    topic: string;
    question: string;
    options: string[];
    answers: string[];
  }>;
}

// ============================================
// Union Type
// ============================================
export type ToolMetadata =
  | BashMetadata
  | FileWriteMetadata
  | FileEditMetadata
  | FileReadMetadata
  | GlobMetadata
  | GrepMetadata
  | TaskMetadata
  | TodoMetadata
  | QuestionMetadata;

// ============================================
// Type Guards
// ============================================

/**
 * Type guard functions for narrowing ToolMetadata union types.
 * Use these to safely access metadata-specific properties.
 * 
 * @example
 * if (isBashMetadata(metadata)) {
 *   console.log(metadata.command); // TypeScript knows this is BashMetadata
 * }
 */
export function isBashMetadata(m: ToolMetadata): m is BashMetadata {
  return m.type === "bash";
}

export function isFileEditMetadata(m: ToolMetadata): m is FileEditMetadata {
  return m.type === "file_edit";
}

export function isFileWriteMetadata(m: ToolMetadata): m is FileWriteMetadata {
  return m.type === "file_write";
}

export function isFileReadMetadata(m: ToolMetadata): m is FileReadMetadata {
  return m.type === "file_read";
}

export function isGlobMetadata(m: ToolMetadata): m is GlobMetadata {
  return m.type === "glob";
}

export function isGrepMetadata(m: ToolMetadata): m is GrepMetadata {
  return m.type === "grep";
}

export function isTaskMetadata(m: ToolMetadata): m is TaskMetadata {
  return m.type === "task";
}

export function isTodoMetadata(m: ToolMetadata): m is TodoMetadata {
  return m.type === "todo";
}

export function isQuestionMetadata(m: ToolMetadata): m is QuestionMetadata {
  return m.type === "question";
}

// ============================================
// Consolidated Type Guards Object
// ============================================

/**
 * Consolidated type guards for cleaner imports.
 * 
 * @example
 * import { TypeGuards } from "../types/tool-metadata";
 * 
 * if (TypeGuards.isBash(metadata)) {
 *   console.log(metadata.command);
 * }
 */
export const TypeGuards = {
  isBash: (m: ToolMetadata): m is BashMetadata => m.type === "bash",
  isFileEdit: (m: ToolMetadata): m is FileEditMetadata => m.type === "file_edit",
  isFileWrite: (m: ToolMetadata): m is FileWriteMetadata => m.type === "file_write",
  isFileRead: (m: ToolMetadata): m is FileReadMetadata => m.type === "file_read",
  isGlob: (m: ToolMetadata): m is GlobMetadata => m.type === "glob",
  isGrep: (m: ToolMetadata): m is GrepMetadata => m.type === "grep",
  isTask: (m: ToolMetadata): m is TaskMetadata => m.type === "task",
  isTodo: (m: ToolMetadata): m is TodoMetadata => m.type === "todo",
  isQuestion: (m: ToolMetadata): m is QuestionMetadata => m.type === "question",
} as const;
