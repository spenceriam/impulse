/**
 * Bilateral gutter layout: 4 columns left + content + 4 columns right.
 *
 * Chat-band lines must use gutterContent(), truncateGutterLine(), or wrapGutterLines().
 * Do not truncate to full terminal width with only a left GUTTER prefix — that spills into
 * the right gutter.
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

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

export interface GutterTintOptions {
  /** ANSI background escape, e.g. "\x1b[48;5;236m". Spans only the inner region. */
  bg: string;
  /** Left-edge accent glyph shown just inside the left gutter (e.g. "▏"). Left-only — never mirrored on the right. */
  accent?: string;
  /** ANSI color escape applied to the accent glyph only (e.g. "\x1b[36m"). */
  accentFg?: string;
}

/**
 * Wrap text to inner width and return gutter-prefixed lines with a background
 * tint spanning the inner region only — both gutters (including the right
 * one) stay plain, uncolored terminal background. Any ANSI resets embedded in
 * the content (e.g. from markdown spans) are re-anchored to the tint so the
 * background stays contiguous across the whole row instead of leaking back to
 * the terminal default partway through a line.
 *
 * Embedded `\n` in `text` are hard line breaks (e.g. a username label above
 * the message body) — each is word-wrapped independently. The accent glyph
 * marks only the very first rendered line of the whole block; continuation
 * lines get equivalent blank space so wrapped text still aligns.
 */
export function wrapGutterTintedLines(
  text: string,
  totalWidth: number,
  opts: GutterTintOptions
): string[] {
  const RESET = "\x1b[0m";
  const inner = innerWidth(totalWidth);
  const accent = opts.accent ?? "";
  const accentWidth = accent.length > 0 ? visibleWidth(accent) + 1 : 0;
  const contentWidth = Math.max(1, inner - accentWidth);
  const normalized = text.length > 0 ? text : " ";

  const paragraphs = normalized.split("\n");
  const allLines = paragraphs.flatMap((p) => wrapTextWithAnsi(p.length > 0 ? p : " ", contentWidth));

  return allLines.map((line, index) => {
    const visible = visibleWidth(line);
    const padded = line + " ".repeat(Math.max(0, contentWidth - visible));
    const bgSafeContent = padded.split(RESET).join(`${RESET}${opts.bg}`);
    const isFirst = index === 0;
    const accentPart =
      accent.length > 0
        ? isFirst
          ? `${opts.accentFg ?? ""}${accent}${RESET}${opts.bg} `
          : " ".repeat(accentWidth)
        : "";
    return `${GUTTER}${opts.bg}${accentPart}${bgSafeContent}${RESET}`;
  });
}
