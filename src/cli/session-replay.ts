/**
 * Build ordered replay steps from persisted session messages for TUI hydration.
 */

import type { Message, MessageContentBlock, ToolCall, ToolResult } from "../session/store.js";
import { isInjectedUserMessage, messageDisplayText } from "../session/injected-message.js";
import { isImpulseUiMessage, parseImpulseUiContent } from "../session/status-events.js";
import { SILENT_TOOLS } from "../tools/silent-tools.js";

/** @deprecated Use SILENT_TOOLS from tools/silent-tools.ts */
export const SILENT_REPLAY_TOOLS = SILENT_TOOLS;

export type ReplayToolResult = {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
};

export type ReplayStep =
  | { type: "user"; text: string }
  | { type: "injected"; text: string }
  | { type: "status"; text: string }
  | { type: "thinking"; text: string; durationMs?: number }
  | { type: "assistantText"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      result: ReplayToolResult;
      durationMs: number;
    };

type StoredToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};

function isToolRoleMessage(msg: Message): msg is Message & StoredToolMessage {
  return msg.role === "tool" && typeof msg.tool_call_id === "string";
}

/** Index tool result rows by tool_call_id for post-rework sessions. */
export function indexToolResults(messages: Message[]): Map<string, { content: string }> {
  const map = new Map<string, { content: string }>();
  for (const msg of messages) {
    if (!isToolRoleMessage(msg)) continue;
    map.set(msg.tool_call_id, { content: msg.content ?? "" });
  }
  return map;
}

/** Infer success when only tool message content is available (no tc.result). */
export function inferToolSuccess(content: string, tcResult?: ToolResult): boolean {
  if (tcResult !== undefined) return tcResult.success;

  const lower = content.toLowerCase();
  if (content.startsWith("[GATE]")) return false;
  if (lower.includes("permission denied")) return false;
  if (lower.includes("[user decision]") && lower.includes("denied")) return false;
  if (lower.startsWith("advisor error:")) return false;
  if (lower.startsWith("error:") && content.length < 500) return false;
  return true;
}

function toolOutputFromSources(tcResult: ToolResult | undefined, toolMsgContent: string | undefined): string {
  if (tcResult?.output) return tcResult.output;
  if (tcResult?.error) return tcResult.error;
  if (toolMsgContent !== undefined) return toolMsgContent;
  return "[No result recorded]";
}

function buildToolResult(
  tc: ToolCall,
  toolResults: Map<string, { content: string }>
): ReplayToolResult {
  const id = tc.id ?? "";
  const toolMsg = id ? toolResults.get(id) : undefined;
  const tcResult = tc.result;
  const output = toolOutputFromSources(tcResult, toolMsg?.content);
  const success =
    output === "[No result recorded]"
      ? false
      : inferToolSuccess(output, tcResult);

  return {
    success,
    output,
    ...(tcResult?.metadata ? { metadata: tcResult.metadata } : {}),
  };
}

function findToolCall(msg: Message, toolCallId: string): ToolCall | undefined {
  return msg.tool_calls?.find((tc) => tc.id === toolCallId);
}

function emitToolStep(
  steps: ReplayStep[],
  tc: ToolCall,
  toolResults: Map<string, { content: string }>
): void {
  if (SILENT_TOOLS.has(tc.tool)) return;
  const id = tc.id ?? `replay_${tc.tool}_${steps.length}`;
  steps.push({
    type: "tool",
    id,
    name: tc.tool,
    args: tc.arguments ?? {},
    result: buildToolResult(tc, toolResults),
    durationMs: 0,
  });
}

function replayAssistantFromContentBlocks(
  msg: Message,
  toolResults: Map<string, { content: string }>,
  steps: ReplayStep[]
): void {
  const blocks = msg.content_blocks ?? [];
  for (const block of blocks) {
    appendBlockStep(block, msg, toolResults, steps);
  }

  // Fallback: content_blocks may reference tools not listed as blocks
  if (msg.tool_calls) {
    const emitted = new Set(
      steps
        .filter((s): s is Extract<ReplayStep, { type: "tool" }> => s.type === "tool")
        .map((s) => s.id)
    );
    for (const tc of msg.tool_calls) {
      const id = tc.id ?? "";
      if (id && emitted.has(id)) continue;
      emitToolStep(steps, tc, toolResults);
    }
  }
}

function appendBlockStep(
  block: MessageContentBlock,
  msg: Message,
  toolResults: Map<string, { content: string }>,
  steps: ReplayStep[]
): void {
  if (block.type === "text" && block.text.trim()) {
    steps.push({ type: "assistantText", text: block.text });
    return;
  }
  if (block.type === "thinking" && block.thinking.trim()) {
    steps.push({
      type: "thinking",
      text: block.thinking,
      ...(block.durationMs !== undefined ? { durationMs: block.durationMs } : {}),
    });
    return;
  }
  if (block.type === "tool_call") {
    const tc = findToolCall(msg, block.tool_call_id);
    if (tc) {
      emitToolStep(steps, tc, toolResults);
    }
  }
}

function replayAssistantLinear(
  msg: Message,
  toolResults: Map<string, { content: string }>,
  steps: ReplayStep[]
): void {
  if (msg.reasoning_content?.trim()) {
    steps.push({
      type: "thinking",
      text: msg.reasoning_content,
      ...(msg.thinking_duration_ms !== undefined
        ? { durationMs: msg.thinking_duration_ms }
        : {}),
    });
  }
  if (msg.content?.trim()) {
    steps.push({ type: "assistantText", text: msg.content });
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      emitToolStep(steps, tc, toolResults);
    }
  }
}

function replayAssistantMessage(
  msg: Message,
  toolResults: Map<string, { content: string }>,
  steps: ReplayStep[]
): void {
  if (msg.content_blocks && msg.content_blocks.length > 0) {
    replayAssistantFromContentBlocks(msg, toolResults, steps);
    return;
  }
  replayAssistantLinear(msg, toolResults, steps);
}

/**
 * Convert persisted messages into ordered UI replay steps.
 * Skips system and standalone tool rows (tool rows are joined via indexToolResults).
 */
export function buildReplaySteps(messages: Message[]): ReplayStep[] {
  const toolResults = indexToolResults(messages);
  const steps: ReplayStep[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (isImpulseUiMessage(msg)) {
        const text = parseImpulseUiContent(msg.content);
        if (/^Mode: /.test(text)) continue;
        steps.push({ type: "status", text });
      }
      continue;
    }
    if (isToolRoleMessage(msg)) continue;

    if (msg.role === "user") {
      const text = messageDisplayText(msg);
      if (isInjectedUserMessage(msg)) {
        steps.push({ type: "injected", text });
      } else {
        steps.push({ type: "user", text });
      }
      continue;
    }

    if (msg.role === "assistant") {
      replayAssistantMessage(msg, toolResults, steps);
    }
  }

  return steps;
}
