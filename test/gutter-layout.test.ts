import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  GUTTER,
  GUTTER_WIDTH,
  gutterContent,
  gutterSeparator,
  innerWidth,
  maxLineWidth,
  truncateGutterLine,
  wrapGutterLines,
  wrapGutterTintedLines,
} from "../src/cli/gutter.js";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("gutter layout", () => {
  const cols = 80;

  test("innerWidth reserves both gutters", () => {
    expect(innerWidth(cols)).toBe(cols - 8);
  });

  test("maxLineWidth reserves right gutter", () => {
    expect(maxLineWidth(cols)).toBe(cols - GUTTER_WIDTH);
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

describe("wrapGutterTintedLines (§5a user-message tint)", () => {
  const bg = "\x1b[48;5;236m";
  const accent = "▏";
  const accentFg = "\x1b[36m";

  test("every line stays within max line width across narrow widths", () => {
    for (const width of [40, 60, 80]) {
      const lines = wrapGutterTintedLines("word ".repeat(30), width, { bg, accent, accentFg });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(maxLineWidth(width));
      }
    }
  });

  test("left gutter stays plain — no bg color before the accent glyph", () => {
    const [line] = wrapGutterTintedLines("hello", 80, { bg, accent, accentFg });
    expect(line!.startsWith(GUTTER)).toBe(true);
  });

  test("right gutter stays plain — line ends with a reset, not mid-tint", () => {
    const lines = wrapGutterTintedLines("hello world", 80, { bg, accent, accentFg });
    for (const line of lines) {
      expect(line.endsWith("\x1b[0m")).toBe(true);
    }
  });

  test("accent glyph appears exactly once per line, left of the content", () => {
    const [line] = wrapGutterTintedLines("hello", 80, { bg, accent, accentFg });
    const plain = stripAnsi(line!);
    const accentIndex = plain.indexOf(accent);
    expect(accentIndex).toBeGreaterThan(-1);
    expect(plain.indexOf("hello")).toBeGreaterThan(accentIndex);
  });

  test("re-anchors embedded resets so the tint stays contiguous across styled spans", () => {
    // Simulates markdown-rendered inline styling (e.g. **bold**) inside the message.
    const styled = `plain \x1b[1mbold\x1b[0m plain again`;
    const [line] = wrapGutterTintedLines(styled, 80, { bg });
    // Every reset except the final terminator must be immediately followed by
    // the bg re-apply — otherwise the tint would visibly drop out mid-row.
    const resetIndices: number[] = [];
    let from = 0;
    while (true) {
      const idx = line!.indexOf("\x1b[0m", from);
      if (idx === -1) break;
      resetIndices.push(idx);
      from = idx + 1;
    }
    expect(resetIndices.length).toBeGreaterThan(1); // embedded reset + trailing terminator
    const finalIndex = resetIndices[resetIndices.length - 1]!;
    for (const idx of resetIndices) {
      if (idx === finalIndex) continue;
      expect(line!.slice(idx, idx + "\x1b[0m".length + bg.length)).toBe(`\x1b[0m${bg}`);
    }
  });

  test("without an accent, content still starts right after the gutter", () => {
    const [line] = wrapGutterTintedLines("hello", 80, { bg });
    const plain = stripAnsi(line!);
    expect(plain.startsWith(`${GUTTER}hello`)).toBe(true);
  });

  test("embedded newlines (username label + message) wrap as one tinted block", () => {
    const lines = wrapGutterTintedLines("Spencer\nhello there", 80, { bg, accent, accentFg });
    expect(lines.length).toBe(2);
    const plainFirst = stripAnsi(lines[0]!);
    const plainSecond = stripAnsi(lines[1]!);
    expect(plainFirst).toContain(accent);
    expect(plainFirst).toContain("Spencer");
    // Accent marks only the first line of the whole block, not every line.
    expect(plainSecond).not.toContain(accent);
    expect(plainSecond).toContain("hello there");
    // Continuation line's text still starts at the same column as the first line's content.
    const firstContentCol = plainFirst.indexOf("Spencer");
    const secondContentCol = plainSecond.indexOf("hello there");
    expect(secondContentCol).toBe(firstContentCol);
  });
});
