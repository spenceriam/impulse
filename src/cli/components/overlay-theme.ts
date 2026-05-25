/**
 * Shared ANSI styling for modal overlays (question, permission, list pickers).
 */

import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

/** 256-color panel background (matches question/permission overlays). */
export const OVERLAY_BG = "\x1b[48;5;233m";

export const overlayAnsi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};

export const OVERLAY_TITLE_FG = 39;
export const OVERLAY_MUTED_FG = 250;
export const OVERLAY_DIM_FG = 90;
export const OVERLAY_SELECT_BG = 39;
export const OVERLAY_SELECT_FG = 16;

export function overlayDim(s: string): string {
  return overlayAnsi.fg(OVERLAY_DIM_FG, s);
}

export function overlayMuted(s: string): string {
  return overlayAnsi.fg(OVERLAY_MUTED_FG, s);
}

export function padToWidth(line: string, width: number): string {
  const truncated = truncateToWidth(line, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  const pad = padding > 0 ? " ".repeat(padding) : "";
  return `${truncated}${pad}`;
}

/** Full-width line with consistent panel background (padding keeps fill). */
export function bgLine(line: string, width: number): string {
  const padded = padToWidth(line, width).replace(
    /\x1b\[0m/g,
    `${overlayAnsi.reset}${OVERLAY_BG}`
  );
  return `${OVERLAY_BG}${padded}${OVERLAY_BG}`;
}

/** Top border with bold colored title. */
export function overlayTitleLine(
  title: string,
  boxWidth: number,
  titleFg = OVERLAY_TITLE_FG
): string {
  const titleText = `${overlayAnsi.bold}${overlayAnsi.fg(titleFg, title)}${overlayAnsi.reset}`;
  const dashPad = Math.max(0, boxWidth - visibleWidth(title) - 6);
  return bgLine(`┌─ ${titleText} ${"─".repeat(dashPad)}┐`, boxWidth);
}

export function overlayEmptyLine(boxWidth: number): string {
  return bgLine("│" + " ".repeat(Math.max(0, boxWidth - 2)) + "│", boxWidth);
}

export function overlayBottomBorder(boxWidth: number): string {
  return bgLine(`└${"─".repeat(Math.max(0, boxWidth - 2))}┘`, boxWidth);
}

/** Full-width dim panel line (no side borders) for backdrop fill. */
export function overlayBackdropLine(boxWidth: number): string {
  return bgLine(" ".repeat(Math.max(0, boxWidth)), boxWidth);
}

/** Lines of chrome excluding list rows (for maxHeight budgeting). */
export function overlayChromeLineCount(helpLineCount: number): number {
  return 5 + helpLineCount + 1;
}

export function maxListRowsForHeight(
  maxHeight: number,
  helpLineCount: number
): number {
  return Math.max(1, maxHeight - overlayChromeLineCount(helpLineCount));
}
