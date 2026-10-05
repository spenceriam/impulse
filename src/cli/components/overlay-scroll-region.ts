/**
 * Shared vertical viewport slicing for modal overlays.
 */
import { isDown, isEnd, isHome, isPageDown, isPageUp, isUp } from "../keys.js";

export const OVERLAY_SCROLL_FOOTER = "↑↓ scroll · PgUp/PgDn · Home/End";

export interface OverlayScrollSlice {
  visibleLines: string[];
  needsScroll: boolean;
  maxScrollTop: number;
}

export function sliceOverlayBody(
  bodyLines: string[],
  viewportLines: number,
  scrollTop: number
): OverlayScrollSlice {
  const viewport = Math.max(1, viewportLines);
  const needsScroll = bodyLines.length > viewport;
  const maxScrollTop = Math.max(0, bodyLines.length - viewport);
  const top = Math.min(Math.max(0, scrollTop), maxScrollTop);
  return {
    visibleLines: bodyLines.slice(top, top + viewport),
    needsScroll,
    maxScrollTop,
  };
}

export function overlayScrollPageStep(viewportLines: number): number {
  return Math.max(1, viewportLines - 1);
}

export function handleOverlayScrollInput(
  data: string,
  scrollTop: number,
  maxScrollTop: number,
  pageStep: number
): number | null {
  if (maxScrollTop === 0) return null;

  if (isUp(data) || data === "k") {
    return Math.max(0, scrollTop - 1);
  }
  if (isDown(data) || data === "j") {
    return Math.min(maxScrollTop, scrollTop + 1);
  }
  if (isPageUp(data) || data === "\x1b[b") {
    return Math.max(0, scrollTop - pageStep);
  }
  if (isPageDown(data) || data === "\x1b[f") {
    return Math.min(maxScrollTop, scrollTop + pageStep);
  }
  if (isHome(data) || data === "g") {
    return 0;
  }
  if (isEnd(data) || data === "G") {
    return maxScrollTop;
  }
  return null;
}

export interface ScrollableOverlayInput {
  top: string[];
  body: string[];
  bottom: string[];
  maxHeight: number;
  scrollTop: number;
  keepVisible?: { start: number; length: number };
}

export interface ScrollableOverlayResult {
  lines: string[];
  scrollTop: number;
  needsScroll: boolean;
}

/** Pinned top/bottom chrome with a vertically sliced body. */
export function composeScrollableOverlay(
  input: ScrollableOverlayInput
): ScrollableOverlayResult {
  const chrome = input.top.length + input.bottom.length;
  if (input.maxHeight <= 0 || input.body.length + chrome <= input.maxHeight) {
    return {
      lines: [...input.top, ...input.body, ...input.bottom],
      scrollTop: 0,
      needsScroll: false,
    };
  }
  const viewport = Math.max(1, input.maxHeight - chrome);
  let scrollTop = input.scrollTop;
  if (input.keepVisible) {
    const { start, length } = input.keepVisible;
    const end = start + Math.max(1, length) - 1;
    if (start < scrollTop) scrollTop = start;
    else if (end > scrollTop + viewport - 1) scrollTop = end - viewport + 1;
  }
  const slice = sliceOverlayBody(input.body, viewport, scrollTop);
  return {
    lines: [...input.top, ...slice.visibleLines, ...input.bottom],
    scrollTop: Math.min(Math.max(0, scrollTop), slice.maxScrollTop),
    needsScroll: slice.needsScroll,
  };
}
