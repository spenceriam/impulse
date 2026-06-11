/**
 * Persist session state when a turn is aborted mid-stream or mid-tool execution.
 */

import { SessionManager } from "../session/manager.js";
import type { Message } from "../session/store.js";

export const INTERRUPTION_MARKER =
  "[Request interrupted by user — the in-progress task flow was cancelled. Treat the user's next message as the new priority; do not resume the previous flow unless asked.]";

export const TOOL_CANCELLED_BY_USER = "Cancelled by user.";

export type AbortTurnContext = {
  /** Assistant text accumulated this iteration but not yet persisted. */
  iterationText: string;
  /** Whether the assistant message for this iteration was already written. */
  iterationAssistantPersisted: boolean;
};

/** Collect tool_call ids that already have a tool-role result in session history. */
export function answeredToolCallIds(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool" && message.tool_call_id) {
      ids.add(message.tool_call_id);
    }
  }
  return ids;
}

/** Last assistant message in history that issued tool_calls. */
export function lastAssistantWithToolCalls(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
      return message;
    }
  }
  return undefined;
}

export async function finalizeAbortedTurn(ctx: AbortTurnContext): Promise<void> {
  if (!ctx.iterationAssistantPersisted && ctx.iterationText.trim()) {
    await SessionManager.addMessage({
      role: "assistant",
      content: ctx.iterationText,
      timestamp: new Date().toISOString(),
    });
  }

  const messages = SessionManager.getCurrentSession()?.messages ?? [];
  const answered = answeredToolCallIds(messages);
  const dangling = lastAssistantWithToolCalls(messages);

  if (dangling?.tool_calls) {
    for (const toolCall of dangling.tool_calls) {
      const id = toolCall.id;
      if (!id || answered.has(id)) continue;
      await SessionManager.addMessage({
        role: "tool",
        content: TOOL_CANCELLED_BY_USER,
        tool_call_id: id,
        timestamp: new Date().toISOString(),
      });
      answered.add(id);
    }
  }

  await SessionManager.addMessage({
    role: "user",
    content: INTERRUPTION_MARKER,
    injected: true,
    timestamp: new Date().toISOString(),
  });
}
