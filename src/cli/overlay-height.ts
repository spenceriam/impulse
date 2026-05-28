/**
 * Viewport-aware max height for bottom-anchored overlays (permission, etc.).
 */

/** Lines reserved below overlay: prompt, separators, context bar, margins, offsetY. */
export const PERMISSION_OVERLAY_RESERVED_BOTTOM = 12;

export function overlayMaxHeightForContent(
  terminalRows: number,
  contentLineCount: number,
  reservedBottom: number = PERMISSION_OVERLAY_RESERVED_BOTTOM,
  opts?: { min?: number; topMargin?: number }
): number {
  const topMargin = opts?.topMargin ?? 1;
  const minHeight = opts?.min ?? 10;
  const available = Math.max(1, terminalRows - reservedBottom - topMargin);
  const desired = Math.max(minHeight, contentLineCount);
  return Math.min(desired, available);
}
