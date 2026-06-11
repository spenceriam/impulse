/**
 * Unified token estimation for context %, auto-compact, and loop gates.
 */

import type { ChatMessage, ToolDefinition } from "../api/types.js";
import type { Message } from "./store.js";
export const CHARS_PER_TOKEN = 3.5;

/** System prompt + tool-definition overhead when full request shape is unavailable. */
export const SESSION_BASE_OVERHEAD_TOKENS = 5000;

export function estimateTokensFromSerialized(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
}

export function estimateRequestTokens(
  messages: ChatMessage[],
  tools: ToolDefinition[] = []
): number {
  return estimateTokensFromSerialized({
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  });
}

/** Session messages only (no system prompt / tool defs) — footer fallback before first API turn. */
export function estimateSessionMessagesTokens(messages: Message[]): number {
  return estimateTokensFromSerialized(messages);
}

export function estimateSessionContextTokens(
  messages: Message[],
  overheadTokens = SESSION_BASE_OVERHEAD_TOKENS
): number {
  return overheadTokens + estimateSessionMessagesTokens(messages);
}

export function computeContextPct(tokens: number, contextWindow: number): number {
  if (contextWindow <= 0) return 0;
  return Math.max(0, Math.min(1, tokens / contextWindow));
}

export function applySafetyMargin(tokens: number, margin: number): number {
  return Math.ceil(tokens * margin);
}

/** Prefer provider prompt_tokens for footer context fill. */
export function resolveFooterContextTokens(opts: {
  promptTokens: number | undefined;
  estimatedTokens: number;
}): number {
  if (opts.promptTokens !== undefined && opts.promptTokens > 0) {
    return opts.promptTokens;
  }
  return opts.estimatedTokens;
}
