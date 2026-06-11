import type { Message } from "./store.js";
import { normalizePasteContent } from "../cli/prompt-input.js";

/** User-visible text for a stored message (API content when expanded). */
export function messageDisplayText(msg: Message): string {
  const raw = typeof msg.apiContent === "string" ? msg.apiContent : (msg.content ?? "");
  return raw.includes("\r") ? normalizePasteContent(raw) : raw;
}

/**
 * Whether a user message was injected by impulse (steer, nudge, interrupt marker, etc.).
 * Untagged legacy rows fall back to known marker prefixes.
 */
export function isInjectedUserMessage(msg: Message): boolean {
  if (msg.role !== "user") return false;
  if (msg.injected) return true;

  const text = messageDisplayText(msg);
  return (
    text.startsWith("[User steering") ||
    text.startsWith("Steering note (apply before your next action):") ||
    text.startsWith("[Request interrupted") ||
    text.startsWith("[System] Permission bypass is active.") ||
    text.startsWith("[System] Loop guard stopped this turn (") ||
    text.startsWith("[System] Stop replanning.") ||
    text.startsWith("Context pressure note") ||
    text === "Please respond in English."
  );
}
