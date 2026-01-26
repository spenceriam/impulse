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
}

// ============================================
// File Edit Tool Metadata
// ============================================
export interface FileEditMetadata {
  type: "file_edit";
  filePath: string;          // Absolute or relative path
  diff: string;              // Unified diff format string
  linesAdded: number;        // Count of lines with + prefix
  linesRemoved: number;      // Count of lines with - prefix
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
  matchCount: number;        // Number of files matched
}

// ============================================
// Grep Tool Metadata
// ============================================
export interface GrepMetadata {
  type: "grep";
  pattern: string;           // Regex pattern searched
  path?: string;             // Search root path
  matchCount: number;        // Number of matches found
}

// ============================================
// Task (Subagent) Tool Metadata
// ============================================
export interface TaskMetadata {
  type: "task";
  subagentType: string;      // "explore" | "general"
  description: string;       // Task description
  actions: string[];         // Summary of actions taken (max 5)
  toolCallCount: number;     // Total tool calls made by subagent
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
  | TaskMetadata;

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
} as const;
