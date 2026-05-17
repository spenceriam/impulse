/**
 * Gutter constants and helpers for consistent 4-space margins.
 *
 * Every visual line in the TUI gets 4 spaces on the left.
 * The right gutter is preserved naturally by pi-tui's truncateToWidth.
 */

import { truncateToWidth } from "@mariozechner/pi-tui";

export const GUTTER = "    ";
export const GUTTER_WIDTH = 4;
/** Combined width of left + right gutter */
export const TOTAL_GUTTER_WIDTH = 8;

/** Inner content width after subtracting both gutters */
export function innerWidth(totalWidth: number): number {
  return Math.max(1, totalWidth - TOTAL_GUTTER_WIDTH);
}

/**
 * Prepend left gutter and truncate to fit total width.
 */
export function gutterContent(content: string, totalWidth: number): string {
  return truncateToWidth(GUTTER + content, totalWidth);
}

/**
 * Render a separator line with gutters on both sides.
 * ─ characters fill the inner region.
 */
export function gutterSeparator(width: number): string {
  const inner = Math.max(0, width - TOTAL_GUTTER_WIDTH);
  return GUTTER + "─".repeat(inner) + GUTTER;
}
