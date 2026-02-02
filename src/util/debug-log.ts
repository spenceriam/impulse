/**
 * Debug Logging Utility
 * 
 * When enabled, writes full conversation data to ~/.config/impulse/debug/
 * for debugging purposes.
 */

import { Global } from "../global";
import fs from "fs/promises";
import path from "path";

let debugEnabled = false;
let sessionLogPath: string | null = null;

/**
 * Enable debug logging
 */
export async function enableDebugLog(): Promise<string> {
  debugEnabled = true;
  
  // Create debug directory
  const debugDir = path.join(Global.Path.data, "debug");
  await fs.mkdir(debugDir, { recursive: true });
  
  // Create session log file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  sessionLogPath = path.join(debugDir, `session-${timestamp}.jsonl`);
  
  // Write header
  await appendLog({
    type: "session_start",
    timestamp: new Date().toISOString(),
    version: "0.20.1",
  });
  
  return sessionLogPath;
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Get the current debug log path
 */
export function getDebugLogPath(): string | null {
  return sessionLogPath;
}

/**
 * Append a log entry (JSON Lines format)
 */
async function appendLog(data: Record<string, unknown>): Promise<void> {
  if (!debugEnabled || !sessionLogPath) return;
  
  try {
    const line = JSON.stringify(data) + "\n";
    await fs.appendFile(sessionLogPath, line, "utf-8");
  } catch (error) {
    // Silently fail - don't break the app for debug logging
    console.error("Debug log write failed:", error);
  }
}

/**
 * Log a user message
 */
export async function logUserMessage(content: string, attachments?: string[]): Promise<void> {
  await appendLog({
    type: "user_message",
    timestamp: new Date().toISOString(),
    content,
    attachments,
  });
}

/**
 * Log an assistant message
 */
export async function logAssistantMessage(
  content: string,
  reasoning?: string,
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
): Promise<void> {
  await appendLog({
    type: "assistant_message",
    timestamp: new Date().toISOString(),
    content,
    reasoning,
    toolCalls,
  });
}

/**
 * Log a tool call execution
 */
export async function logToolExecution(
  toolName: string,
  args: unknown,
  result: { success: boolean; output: string }
): Promise<void> {
  await appendLog({
    type: "tool_execution",
    timestamp: new Date().toISOString(),
    tool: toolName,
    arguments: args,
    success: result.success,
    output: result.output,
  });
}

/**
 * Log an API request
 */
export async function logAPIRequest(
  model: string,
  messages: Array<{ role: string; content?: string | null }>,
  tools?: unknown[]
): Promise<void> {
  await appendLog({
    type: "api_request",
    timestamp: new Date().toISOString(),
    model,
    messageCount: messages.length,
    messages: messages.map(m => ({
      role: m.role,
      contentLength: typeof m.content === "string" ? m.content.length : 0,
      contentPreview: typeof m.content === "string" ? m.content.slice(0, 200) : null,
    })),
    toolCount: tools?.length || 0,
  });
}

/**
 * Log an API response/stream event
 */
export async function logAPIResponse(
  event: string,
  data?: unknown
): Promise<void> {
  await appendLog({
    type: "api_response",
    timestamp: new Date().toISOString(),
    event,
    data,
  });
}

/**
 * Log event-loop lag samples
 */
export async function logEventLoopLag(data: { lagMs: number; intervalMs: number }): Promise<void> {
  await appendLog({
    type: "event_loop_lag",
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Log an error
 */
export async function logError(
  context: string,
  error: Error | string
): Promise<void> {
  await appendLog({
    type: "error",
    timestamp: new Date().toISOString(),
    context,
    error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
  });
}

/**
 * Log raw API messages being sent
 */
export async function logRawAPIMessages(
  messages: Array<{ role: string; content?: string | null; reasoning_content?: string; tool_calls?: unknown[] }>
): Promise<void> {
  await appendLog({
    type: "raw_api_messages",
    timestamp: new Date().toISOString(),
    messages,
  });
}
