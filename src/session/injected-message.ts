import type { Message } from "./store.js";

/** User-visible text for a stored message (API content when expanded). */
export function messageDisplayText(msg: Message): string {
  return typeof msg.apiContent === "string" ? msg.apiContent : (msg.content ?? "");
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
    text.startsWith("[Request interrupted") ||
    text.startsWith("[System]") ||
    text.startsWith("Context pressure note")
  );
}
