/**
 * Build ordered replay steps from persisted session messages for TUI hydration.
 */

import type { Message, MessageContentBlock, ToolCall, ToolResult } from "../session/store.js";
import { isInjectedUserMessage, messageDisplayText } from "../session/injected-message.js";
import {
  COMPACTION_SUMMARY_PREFIX,
  isImpulseSettleMessage,
  isImpulseUiMessage,
  parseImpulseSettleContent,
  parseImpulseUiContent,
} from "../session/status-events.js";
import { SILENT_TOOLS } from "../tools/silent-tools.js";
import { isSilentUnchangedTodoWrite } from "./components/tool-block.js";

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
    }
  /** Quiet density: model-authored Recap line persisted on the assistant message. */
  | { type: "recap"; text: string }
  /** Quiet density: settle line ("Worked for 31s using 1 tool") persisted by the renderer (#176). */
  | { type: "settle"; text: string }
  /** Compaction summary ("Previous conversation summary:…") — rendered as ghost chrome at the compaction point. */
  | { type: "compacted"; text: string };

export interface BuildReplayOptions {
  /** Quiet density: skip per-tool rows (live Quiet never shows them) and
   *  emit persisted Recap lines instead. Verbose keeps full tool history. */
  quiet?: boolean;
}

type StoredToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};

function isToolRoleMessage(msg: Message): msg is Message & StoredToolMessage {
  return msg.role === "tool" && typeof msg.tool_call_id === "string";
}

/** Legacy sessions (pre inline-thinking filter) can hold raw
 *  <think>/<thinking>/<reasoning> envelopes inside persisted assistant
 *  content; strip them at replay so old transcripts render clean in both
 *  densities. */
const LEGACY_THINK_ENVELOPE_RE = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;
const LEGACY_THINK_OPEN_RE = /<(?:think|thinking|reasoning)>[\s\S]*$/i;

function stripLegacyThinkTags(text: string): string {
  let out = text.replace(LEGACY_THINK_ENVELOPE_RE, "");
  // Unclosed envelope at stream end (crashed session): drop the tail.
  out = out.replace(LEGACY_THINK_OPEN_RE, "");
  return out.trim();
}

/** Index tool result rows by tool_call_id for post-rework sessions. */
export function indexToolResults(
  messages: Message[]
): Map<string, { content: string; durationMs?: number }> {
  const map = new Map<string, { content: string; durationMs?: number }>();
  for (const msg of messages) {
    if (!isToolRoleMessage(msg)) continue;
    map.set(msg.tool_call_id, {
      content: msg.content ?? "",
      ...(typeof msg.durationMs === "number" ? { durationMs: msg.durationMs } : {}),
    });
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
  toolResults: Map<string, { content: string; durationMs?: number }>
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
  toolResults: Map<string, { content: string; durationMs?: number }>,
  quiet: boolean
): void {
  if (quiet) return; // Quiet replay shows Recap lines, never per-tool rows
  if (SILENT_TOOLS.has(tc.tool)) return;
  const result = buildToolResult(tc, toolResults);
  if (isSilentUnchangedTodoWrite(tc.tool, result)) return;
  const id = tc.id ?? `replay_${tc.tool}_${steps.length}`;
  steps.push({
    type: "tool",
    id,
    name: tc.tool,
    args: tc.arguments ?? {},
    result,
    durationMs: (id ? toolResults.get(id)?.durationMs : undefined) ?? 0,
  });
}

function emitRecapStep(steps: ReplayStep[], msg: Message, quiet: boolean): void {
  if (!quiet) return;
  const recap = msg.recap?.trim();
  if (!recap) return;
  steps.push({ type: "recap", text: recap });
}

function replayAssistantFromContentBlocks(
  msg: Message,
  toolResults: Map<string, { content: string; durationMs?: number }>,
  steps: ReplayStep[],
  quiet: boolean
): void {
  const blocks = msg.content_blocks ?? [];
  const messageStart = steps.length;
  for (const block of blocks) {
    appendBlockStep(block, msg, toolResults, steps, quiet, messageStart);
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
      emitToolStep(steps, tc, toolResults, quiet);
    }
  }
  emitRecapStep(steps, msg, quiet);
}

function appendBlockStep(
  block: MessageContentBlock,
  msg: Message,
  toolResults: Map<string, { content: string; durationMs?: number }>,
  steps: ReplayStep[],
  quiet: boolean,
  messageStart = 0
): void {
  if (block.type === "text" && block.text.trim()) {
    const clean = stripLegacyThinkTags(block.text);
    if (clean) steps.push({ type: "assistantText", text: clean });
    return;
  }
  if (block.type === "thinking" && block.thinking.trim()) {
    // Live, thinking collapses into ONE block per turn. Replay used to push a
    // row per persisted block, so a restored turn showed a dozen "Thought
    // for 0.4s" rows (#176). Merge into the live shape: one step per
    // assistant message, durations summed.
    mergeThinkingStep(steps, block.thinking, block.durationMs, messageStart);
    return;
  }
  if (block.type === "tool_call") {
    const tc = findToolCall(msg, block.tool_call_id);
    if (tc) {
      emitToolStep(steps, tc, toolResults, quiet);
    }
  }
}

/** Merge a thinking block into the pending thinking step for this message (#176). */
function mergeThinkingStep(
  steps: ReplayStep[],
  thinking: string,
  durationMs: number | undefined,
  messageStart: number
): void {
  for (let i = steps.length - 1; i >= messageStart; i--) {
    const step = steps[i]!;
    if (step.type !== "thinking") break;
    step.text = `${step.text}\n\n${thinking}`.trim();
    step.durationMs = (step.durationMs ?? 0) + (durationMs ?? 0);
    return;
  }
  steps.push({
    type: "thinking",
    text: thinking,
    ...(durationMs !== undefined ? { durationMs } : {}),
  });
}

function replayAssistantLinear(
  msg: Message,
  toolResults: Map<string, { content: string; durationMs?: number }>,
  steps: ReplayStep[],
  quiet: boolean
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
    const clean = stripLegacyThinkTags(msg.content);
    if (clean) steps.push({ type: "assistantText", text: clean });
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      emitToolStep(steps, tc, toolResults, quiet);
    }
  }
  emitRecapStep(steps, msg, quiet);
}

function replayAssistantMessage(
  msg: Message,
  toolResults: Map<string, { content: string; durationMs?: number }>,
  steps: ReplayStep[],
  quiet: boolean
): void {
  if (msg.content_blocks && msg.content_blocks.length > 0) {
    replayAssistantFromContentBlocks(msg, toolResults, steps, quiet);
    return;
  }
  replayAssistantLinear(msg, toolResults, steps, quiet);
}

/**
 * Convert persisted messages into ordered UI replay steps.
 * Skips system and standalone tool rows (tool rows are joined via indexToolResults).
 * `quiet` replay drops per-tool rows and emits persisted Recap lines instead.
 */
export function buildReplaySteps(
  messages: Message[],
  opts: BuildReplayOptions = {}
): ReplayStep[] {
  const quiet = opts.quiet === true;
  const toolResults = indexToolResults(messages);
  const steps: ReplayStep[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Compaction summary — the handoff for everything that was compacted.
      // Replay it as ghost chrome at the compaction point; skipping it leaves
      // the restored session with an invisible gap.
      if (msg.content.startsWith(COMPACTION_SUMMARY_PREFIX)) {
        const text = msg.content.slice(COMPACTION_SUMMARY_PREFIX.length).trim();
        if (text) steps.push({ type: "compacted", text });
        continue;
      }
      // Persisted settle line ("Worked for …") — restore the live turn's
      // settle anchors (#176).
      if (isImpulseSettleMessage(msg)) {
        const text = parseImpulseSettleContent(msg.content).trim();
        if (text) steps.push({ type: "settle", text });
        continue;
      }
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
      replayAssistantMessage(msg, toolResults, steps, quiet);
    }
  }

  return steps;
}
