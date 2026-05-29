import { describe, expect, test } from "bun:test";
import { innerWidth, maxLineWidth } from "../src/cli/gutter.js";

describe("PromptInput gutter budget", () => {
  test("editor width and line cap reserve bilateral gutters", () => {
    const width = 80;
    const arrowSuffixWidth = 3;
    const editorWidth = innerWidth(width) - arrowSuffixWidth;
    expect(editorWidth).toBe(width - 8 - arrowSuffixWidth);
    expect(maxLineWidth(width)).toBe(width - 4);
    expect(editorWidth + arrowSuffixWidth + 4).toBeLessThanOrEqual(width);
  });
});
