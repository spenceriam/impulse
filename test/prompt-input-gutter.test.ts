import { describe, expect, test } from "bun:test";
import { GUTTER_WIDTH, TOTAL_GUTTER_WIDTH, innerWidth, maxLineWidth } from "../src/cli/gutter.js";

describe("PromptInput gutter budget", () => {
  test("editor width and line cap reserve 1-col bilateral gutters", () => {
    const width = 80;
    const arrowSuffixWidth = 3;
    const editorWidth = innerWidth(width) - arrowSuffixWidth;
    expect(TOTAL_GUTTER_WIDTH).toBe(2);
    expect(GUTTER_WIDTH).toBe(1);
    expect(editorWidth).toBe(width - 2 - arrowSuffixWidth);
    expect(maxLineWidth(width)).toBe(width - 1);
    expect(editorWidth + arrowSuffixWidth + GUTTER_WIDTH).toBeLessThanOrEqual(width);
  });
});
