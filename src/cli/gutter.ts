/**
 * Session content width helpers.
 *
 * v1.11.0 (#153 dogfood): intentional left/right gutters removed — content uses
 * the full terminal width. Helpers keep their names for call-site compatibility;
 * widths no longer reserve side margins.
 */

import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

/** Left prefix for chat/status lines (empty — full-width session content). */
export const GUTTER = "";
export const GUTTER_WIDTH = 0;
/** Combined width of left + right gutter (0 when gutters are disabled). */
export const TOTAL_GUTTER_WIDTH = 0;

/** Inner content width (full terminal width when gutters are off). */
export function innerWidth(totalWidth: number): number {
  return Math.max(1, totalWidth - TOTAL_GUTTER_WIDTH);
}

/** Max visible width for a full terminal row. */
export function maxLineWidth(totalWidth: number): number {
  return Math.max(1, totalWidth - GUTTER_WIDTH);
}

/**
 * Prefix left gutter (none) and truncate to terminal width.
 */
export function gutterContent(content: string, totalWidth: number): string {
  const inner = innerWidth(totalWidth);
  return GUTTER + truncateToWidth(content, inner);
}

/**
 * Truncate a line that already includes left indent/prefix (tool sub-lines, thinking).
 */
export function truncateGutterLine(line: string, totalWidth: number): string {
  return truncateToWidth(line, maxLineWidth(totalWidth));
}

/** Wrap text to inner width and return lines (no side gutters). */
export function wrapGutterLines(text: string, totalWidth: number): string[] {
  const inner = innerWidth(totalWidth);
  const normalized = text.length > 0 ? text : " ";
  return wrapTextWithAnsi(normalized, inner).map((line) => gutterContent(line, totalWidth));
}

/**
 * Render a separator line across the full terminal width.
 */
export function gutterSeparator(width: number): string {
  const inner = Math.max(0, width - TOTAL_GUTTER_WIDTH);
  return GUTTER + "─".repeat(inner) + GUTTER;
}
