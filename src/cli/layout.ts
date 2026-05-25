/** Minimum usable overlay width on narrow split panes. */
export const OVERLAY_MIN_BOX_WIDTH = 24;

/** Maximum overlay box width on wide terminals. */
export const OVERLAY_MAX_BOX_WIDTH = 74;

/**
 * Compute overlay box width from terminal columns.
 * Never exceeds the terminal or forces a width wider than the pane.
 */
export function overlayBoxWidth(terminalWidth: number, max = OVERLAY_MAX_BOX_WIDTH): number {
  return Math.max(OVERLAY_MIN_BOX_WIDTH, Math.min(terminalWidth - 4, max));
}

/**
 * minWidth for pi-tui showOverlay — scales down on narrow panes.
 */
export function overlayMinWidth(terminalWidth: number): number {
  return Math.min(70, Math.max(OVERLAY_MIN_BOX_WIDTH, terminalWidth - 4));
}

/** Gutter width in columns — tighter on very narrow terminals. */
export function gutterWidth(terminalWidth: number): number {
  return terminalWidth < 50 ? 2 : 4;
}

/** Left gutter string for the current terminal width. */
export function gutterForWidth(terminalWidth: number): string {
  return " ".repeat(gutterWidth(terminalWidth));
}
