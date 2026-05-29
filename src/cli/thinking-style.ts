/**
 * Static styling for thinking block body text (no shimmer).
 * Palette matches status-line dim base (238).
 */

export const THINKING_BODY_STYLE = "\x1b[38;5;238m\x1b[3m";
export const THINKING_BODY_RESET = "\x1b[0m";

export function formatThinkingBodyPart(part: string): string {
  return `${THINKING_BODY_STYLE}${part}${THINKING_BODY_RESET}`;
}
