/**
 * Bilateral gutter layout: 4 columns left + content + 4 columns right.
 *
 * Chat-band lines must use gutterContent(), truncateGutterLine(), or wrapGutterLines().
 * Do not truncate to full terminal width with only a left GUTTER prefix — that spills into
 * the right gutter.
 */

import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

export const GUTTER = "    ";
export const GUTTER_WIDTH = 4;
/** Combined width of left + right gutter */
export const TOTAL_GUTTER_WIDTH = 8;

/** Inner content width after subtracting both gutters */
export function innerWidth(totalWidth: number): number {
  return Math.max(1, totalWidth - TOTAL_GUTTER_WIDTH);
}

/** Max visible width for a full terminal row (reserves right gutter). */
export function maxLineWidth(totalWidth: number): number {
  return Math.max(1, totalWidth - GUTTER_WIDTH);
}

/**
 * Prepend left gutter and truncate content so the line leaves the right gutter empty.
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

/** Wrap text to inner width and return gutter-prefixed lines. */
export function wrapGutterLines(text: string, totalWidth: number): string[] {
  const inner = innerWidth(totalWidth);
  const normalized = text.length > 0 ? text : " ";
  return wrapTextWithAnsi(normalized, inner).map((line) => gutterContent(line, totalWidth));
}

/**
 * Render a separator line with gutters on both sides.
 * ─ characters fill the inner region.
 */
export function gutterSeparator(width: number): string {
  const inner = Math.max(0, width - TOTAL_GUTTER_WIDTH);
  return GUTTER + "─".repeat(inner) + GUTTER;
}
