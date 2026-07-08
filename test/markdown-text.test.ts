import { describe, expect, test } from "bun:test";
import { MarkdownTextBlock } from "../src/cli/components/markdown-text.js";

const BOLD = "\x1b[1m";

function renderLine(markdown: string): string {
  const block = new MarkdownTextBlock("");
  block.setText(markdown);
  const lines = block.render(80);
  return lines[0] ?? "";
}

describe("MarkdownTextBlock header formatting", () => {
  test("bolds an H1 heading", () => {
    expect(renderLine("# Title")).toContain(BOLD);
  });

  test("bolds an H5 heading", () => {
    expect(renderLine("##### Sub-sub-sub-heading")).toContain(BOLD);
  });

  test("bolds an H6 heading", () => {
    expect(renderLine("###### Deepest heading")).toContain(BOLD);
  });

  test("does not bold a bare hash run with no following text", () => {
    expect(renderLine("###")).not.toContain(BOLD);
  });

  test("leaves plain text unstyled", () => {
    expect(renderLine("just some text")).not.toContain(BOLD);
  });
});
