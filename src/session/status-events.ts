/**
 * Persisted UI status events — shown in chat on replay, excluded from API history.
 */

import type { Message } from "./store.js";

export const IMPULSE_UI_PREFIX = "[impulse_ui] ";

export function formatImpulseUiStatus(text: string): string {
  return `${IMPULSE_UI_PREFIX}${text}`;
}

export function isImpulseUiMessage(msg: Message): boolean {
  return msg.role === "system" && msg.content.startsWith(IMPULSE_UI_PREFIX);
}

export function parseImpulseUiContent(content: string): string {
  return content.startsWith(IMPULSE_UI_PREFIX)
    ? content.slice(IMPULSE_UI_PREFIX.length)
    : content;
}
