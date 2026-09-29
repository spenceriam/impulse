import { describe, expect, test } from "bun:test";
import { GUTTER_WIDTH, TOTAL_GUTTER_WIDTH, innerWidth, maxLineWidth } from "../src/cli/gutter.js";

describe("PromptInput width budget", () => {
  test("editor width uses full terminal (gutters removed)", () => {
    const width = 80;
    const arrowSuffixWidth = 3;
    const editorWidth = innerWidth(width) - arrowSuffixWidth;
    expect(TOTAL_GUTTER_WIDTH).toBe(0);
    expect(GUTTER_WIDTH).toBe(0);
    expect(editorWidth).toBe(width - arrowSuffixWidth);
    expect(maxLineWidth(width)).toBe(width);
    expect(editorWidth + arrowSuffixWidth).toBeLessThanOrEqual(width);
  });
});
