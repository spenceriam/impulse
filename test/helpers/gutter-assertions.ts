/**
 * Shared render-assertion helpers for chat-band and overlay components.
 *
 * gutter.ts documents the invariant that chat-band lines must reserve a right
 * gutter, but nothing enforced it — a component could render a line wider than
 * the box it draws (a real bug once found in ProfileOverlay's embedded editor,
 * caused by a naive ANSI-strip that didn't recognize pi-tui's CURSOR_MARKER).
 * These helpers give every component test a cheap, consistent way to catch that
 * class of bug at narrow terminal widths.
 */

import { expect } from "bun:test";
import { CURSOR_MARKER } from "@mariozechner/pi-tui";

/** Narrow widths worth sweeping — narrower than any real terminal, typical split-pane, and wide default. */
export const GUTTER_TEST_WIDTHS = [40, 60, 80] as const;

/**
 * Strip ANSI CSI codes and pi-tui's CURSOR_MARKER (an APC sequence, not a
 * standard CSI code, that the real TUI host recognizes and strips before
 * drawing — a naive `\x1b\[...` regex alone under/over-counts lines that
 * contain it, exactly as it did for ProfileOverlay's embedded Editor).
 */
export function stripAnsiAndMarkers(s: string): string {
  return s.split(CURSOR_MARKER).join("").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Assert that every rendered line is exactly as wide as the box's own first
 * (border) line — no line spills past the right edge, and none render short
 * of it either (which would misalign the frame). Assumes a bordered overlay
 * whose first line is the top border and last line is the bottom border.
 */
export function assertGutterSafe(lines: string[], hostWidth: number): void {
  expect(lines.length).toBeGreaterThan(0);
  const plain = lines.map(stripAnsiAndMarkers);
  const boxWidth = plain[0]!.length;
  expect(boxWidth).toBeLessThanOrEqual(hostWidth);
  for (const line of plain) {
    expect(line.length).toBe(boxWidth);
  }
}

/** Run `render(width)` at each of GUTTER_TEST_WIDTHS and assert gutter safety. */
export function assertGutterSafeAcrossWidths(
  render: (width: number) => string[],
  widths: readonly number[] = GUTTER_TEST_WIDTHS
): void {
  for (const width of widths) {
    assertGutterSafe(render(width), width);
  }
}
