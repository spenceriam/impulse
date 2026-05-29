import { describe, expect, test } from "bun:test";
import {
  overlayMaxHeightForContent,
  PERMISSION_OVERLAY_RESERVED_BOTTOM,
} from "../src/cli/overlay-height.js";

describe("overlayMaxHeightForContent", () => {
  test("caps content to viewport minus reserved bottom", () => {
    const rows = 24;
    const reserved = PERMISSION_OVERLAY_RESERVED_BOTTOM;
    const cap = rows - reserved - 1;
    expect(overlayMaxHeightForContent(rows, 50, reserved)).toBe(cap);
  });

  test("uses at least min height when content is small", () => {
    expect(overlayMaxHeightForContent(40, 5)).toBeGreaterThanOrEqual(10);
  });

  test("long permission content can exceed old fixed cap of 10", () => {
    const h = overlayMaxHeightForContent(40, 18);
    expect(h).toBeGreaterThan(10);
  });
});
