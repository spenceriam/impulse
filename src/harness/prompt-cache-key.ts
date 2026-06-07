import crypto from "crypto";
import type { ChatMessage } from "../api/types.js";
import { getPinnedSystemPrompt } from "./session-cache.js";

function systemPromptFromMessages(messages: ChatMessage[]): string | undefined {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "system") continue;
    if (typeof msg.content === "string" && msg.content.trim()) {
      parts.push(msg.content);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** True when the pinned turn prompt matches the outbound system prompt. */
export function shouldApplySessionCache(systemPrompt: string): boolean {
  const pinned = getPinnedSystemPrompt();
  return Boolean(pinned && pinned === systemPrompt);
}

export function promptCacheKey(systemPrompt: string): string {
  return crypto.createHash("sha256").update(systemPrompt).digest("hex").slice(0, 32);
}

/** OpenAI-compatible `prompt_cache_key` when session stickiness applies. */
export function applyOpenAIPromptCacheKey(
  request: Record<string, unknown>,
  messages: ChatMessage[]
): void {
  const system = systemPromptFromMessages(messages);
  if (system && shouldApplySessionCache(system)) {
    request["prompt_cache_key"] = promptCacheKey(system);
  }
}
