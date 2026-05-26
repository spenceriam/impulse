import { TOTAL_GUTTER_WIDTH } from "./gutter.js";

/** Minimum usable overlay width on narrow split panes. */
export const OVERLAY_MIN_BOX_WIDTH = 24;

/**
 * Compute overlay box width from terminal columns (full width minus gutters).
 */
export function overlayBoxWidth(terminalWidth: number): number {
  return Math.max(OVERLAY_MIN_BOX_WIDTH, terminalWidth - TOTAL_GUTTER_WIDTH);
}

/**
 * minWidth for pi-tui showOverlay — matches content width on narrow panes.
 */
export function overlayMinWidth(terminalWidth: number): number {
  return overlayBoxWidth(terminalWidth);
}

/** Gutter width in columns — tighter on very narrow terminals. */
export function gutterWidth(terminalWidth: number): number {
  return terminalWidth < 50 ? 2 : 4;
}

/** Left gutter string for the current terminal width. */
export function gutterForWidth(terminalWidth: number): string {
  return " ".repeat(gutterWidth(terminalWidth));
}
