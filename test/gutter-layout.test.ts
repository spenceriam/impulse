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

  test("session content uses full terminal width (no side gutters)", () => {
    expect(GUTTER).toBe("");
    expect(GUTTER_WIDTH).toBe(0);
    expect(TOTAL_GUTTER_WIDTH).toBe(0);
    expect(innerWidth(cols)).toBe(cols);
    expect(maxLineWidth(cols)).toBe(cols);
  });

  test("gutterContent stays within terminal width", () => {
    const line = gutterContent("x".repeat(200), cols);
    expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(cols));
  });

  test("gutterSeparator fits terminal width", () => {
    const sep = gutterSeparator(cols);
    expect(visibleWidth(sep)).toBeLessThanOrEqual(cols);
  });

  test("truncateGutterLine caps rows to terminal width", () => {
    const line = truncateGutterLine(`       ${"y".repeat(200)}`, cols);
    expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(cols));
  });

  test("wrapGutterLines uses full width", () => {
    const lines = wrapGutterLines("word ".repeat(40), cols);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(cols));
    }
  });
});
