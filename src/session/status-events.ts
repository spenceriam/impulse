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

/**
 * Quiet settle line ("Worked for 31s using 1 tool") persisted as a system
 * message so a restored session reproduces the live turn's settle anchors
 * (#176). Separate prefix from the generic UI status: settle lines are
 * rendered as ghost chrome, not as status text.
 */
export const IMPULSE_SETTLE_PREFIX = "[impulse_settle] ";

/** Prefix on the compaction summary system message (compact.ts writes it; replay detects it). */
export const COMPACTION_SUMMARY_PREFIX = "Previous conversation summary:";

export function formatImpulseSettle(line: string): string {
  return `${IMPULSE_SETTLE_PREFIX}${line}`;
}

export function isImpulseSettleMessage(msg: Message): boolean {
  return msg.role === "system" && msg.content.startsWith(IMPULSE_SETTLE_PREFIX);
}

export function parseImpulseSettleContent(content: string): string {
  return content.startsWith(IMPULSE_SETTLE_PREFIX)
    ? content.slice(IMPULSE_SETTLE_PREFIX.length)
    : content;
}
