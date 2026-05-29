/**
 * Shared ANSI styling for modal overlays (question, permission, list pickers).
 */

import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";

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

function stripAnsiForWidth(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Pad a list/table row line to width without truncating (wrap if wider).
 */
export function padInnerLine(line: string, width: number): string {
  const plainLen = visibleWidth(stripAnsiForWidth(line));
  if (plainLen <= width) {
    return `${line}${" ".repeat(width - plainLen)}`;
  }
  const wrapped = wrapTextWithAnsi(line, width);
  const first = wrapped[0] ?? "";
  const firstLen = visibleWidth(stripAnsiForWidth(first));
  const pad = Math.max(0, width - firstLen);
  return `${first}${pad > 0 ? " ".repeat(pad) : ""}`;
}

/** Pad a pre-laid-out row to width (no truncate — layout must fit). */
export function padRowLine(line: string, width: number): string {
  const plainLen = visibleWidth(stripAnsiForWidth(line));
  if (plainLen <= width) {
    return `${line}${" ".repeat(width - plainLen)}`;
  }
  return line;
}

/**
 * Box width for overlay render(): always match pi-tui host width so vertical borders align.
 * Content-sized overlays set host width to preferredBoxWidth; shrinking here breaks the right edge.
 */
export function overlayRenderBoxWidth(hostWidth: number): number {
  return Math.max(1, hostWidth);
}

/** Border/chrome line at exact boxWidth (truncate + pad so every row is identical width). */
export function overlayBorderLine(content: string, boxWidth: number): string {
  const fitted = padToWidth(content, boxWidth);
  const withBg = fitted.replace(
    /\x1b\[0m/g,
    `${overlayAnsi.reset}${OVERLAY_BG}`
  );
  return `${OVERLAY_BG}${withBg}${OVERLAY_BG}`;
}

/** Full-width line with consistent panel background (padding keeps fill). */
export function bgLine(line: string, width: number): string {
  return overlayBorderLine(line, width);
}

/** Minimum inner width needed for a styled top border (no dash fill). */
/** Content-sized framed overlay width (capped at terminal). */
export function intrinsicFramedBoxWidth(
  terminalWidth: number,
  title: string,
  innerPlainWidths: number[]
): number {
  const cap = overlayBoxWidth(terminalWidth);
  const chrome = measureOverlayTopChromeWidth(title);
  let maxInner = 20;
  for (const w of innerPlainWidths) {
    maxInner = Math.max(maxInner, w);
  }
  return Math.min(cap, Math.max(24, maxInner + 4, chrome));
}

export function measureOverlayTopChromeWidth(
  title: string,
  titleFg = OVERLAY_TITLE_FG
): number {
  const titleText = `${overlayAnsi.bold}${overlayAnsi.fg(titleFg, title)}${overlayAnsi.reset}`;
  const prefix = `┌─ ${titleText} `;
  return visibleWidth(prefix) + 1;
}

/** Top border with bold colored title. */
export function overlayTitleLine(
  title: string,
  boxWidth: number,
  titleFg = OVERLAY_TITLE_FG
): string {
  const titleText = `${overlayAnsi.bold}${overlayAnsi.fg(titleFg, title)}${overlayAnsi.reset}`;
  const prefix = `┌─ ${titleText} `;
  const suffix = `┐`;
  const dashCount = Math.max(
    0,
    boxWidth - visibleWidth(prefix) - visibleWidth(suffix)
  );
  return overlayBorderLine(
    `${prefix}${"─".repeat(dashCount)}${suffix}`,
    boxWidth
  );
}

export function overlayEmptyLine(boxWidth: number): string {
  return overlayBorderLine(
    "│" + " ".repeat(Math.max(0, boxWidth - 2)) + "│",
    boxWidth
  );
}

export function overlayBottomBorder(boxWidth: number): string {
  return overlayBorderLine(
    `└${"─".repeat(Math.max(0, boxWidth - 2))}┘`,
    boxWidth
  );
}

/** Side border row: inner content padded to innerWidth inside a boxWidth frame. */
export function overlaySideLine(
  inner: string,
  innerWidth: number,
  boxWidth: number
): string {
  const body = padToWidth(padInnerLine(inner, innerWidth), innerWidth);
  return overlayBorderLine(`│ ${body} │`, boxWidth);
}

/** Append wrapped lines as side-bordered rows. */
export function overlayPushWrapped(
  lines: string[],
  content: string,
  innerWidth: number,
  boxWidth: number
): void {
  const parts = content.includes("\n") ? content.split("\n") : null;
  if (parts) {
    for (const part of parts) {
      lines.push(overlaySideLine(part, innerWidth, boxWidth));
    }
    return;
  }
  for (const part of wrapTextWithAnsi(content, innerWidth)) {
    lines.push(overlaySideLine(part, innerWidth, boxWidth));
  }
}

/** Full-width dim panel line (no side borders) for backdrop fill. */
export function overlayBackdropLine(boxWidth: number): string {
  return overlayBorderLine(" ".repeat(Math.max(0, boxWidth)), boxWidth);
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
