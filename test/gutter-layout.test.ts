import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  GUTTER,
  GUTTER_WIDTH,
  TOTAL_GUTTER_WIDTH,
  gutterContent,
  gutterSeparator,
  innerWidth,
  maxLineWidth,
  truncateGutterLine,
  wrapGutterLines,
} from "../src/cli/gutter.js";

describe("gutter layout", () => {
  const cols = 80;

  test("session content uses exactly 1-col left and right gutters", () => {
    expect(GUTTER).toBe(" ");
    expect(GUTTER_WIDTH).toBe(1);
    expect(TOTAL_GUTTER_WIDTH).toBe(2);
    expect(innerWidth(cols)).toBe(cols - 2);
    expect(maxLineWidth(cols)).toBe(cols - 1);
  });

  test("gutterContent stays within max line width", () => {
    const line = gutterContent("x".repeat(200), cols);
    expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(cols));
  });

  test("gutterSeparator fits terminal width", () => {
    const sep = gutterSeparator(cols);
    expect(visibleWidth(sep)).toBeLessThanOrEqual(cols);
  });

  test("truncateGutterLine caps prefixed rows", () => {
    const line = truncateGutterLine(`       ${"y".repeat(200)}`, cols);
    expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(cols));
  });

  test("wrapGutterLines respects right gutter", () => {
    const lines = wrapGutterLines("word ".repeat(40), cols);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(cols));
    }
  });
});
