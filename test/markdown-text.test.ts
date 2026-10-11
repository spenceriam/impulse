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

describe("MarkdownTextBlock soft breaks", () => {
  const ITALIC = "\x1b[3m";

  function renderAll(markdown: string, width = 80): string[] {
    const block = new MarkdownTextBlock("");
    block.setText(markdown);
    return block.render(width);
  }

  test("italic spanning a soft break renders italic, not literal asterisks", () => {
    const joined = renderAll(
      "renewed exemptions covering *video games with\ndiscontinued outside-server support* — explicitly includes play"
    ).join("\n");
    expect(joined).toContain(ITALIC);
    expect(joined).not.toContain("*");
  });

  test("paragraph soft breaks join into one wrapped block", () => {
    expect(renderAll("alpha beta\ngamma delta")).toEqual(["alpha beta gamma delta"]);
  });

  test("blank line still splits paragraphs", () => {
    expect(renderAll("alpha\n\nbeta")).toEqual(["alpha", "", "beta"]);
  });

  test("list items stay on separate lines", () => {
    expect(renderAll("- one\n- two")).toEqual(["- one", "- two"]);
  });

  test("headings stay on their own line", () => {
    const lines = renderAll("intro line\n## Section\nbody text");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(BOLD);
  });

  test("lines inside code fences are never joined", () => {
    expect(renderAll("```\nline one\nline two\n```")).toEqual([
      "```",
      "line one",
      "line two",
      "```",
    ]);
  });

  test("paragraph before a fence does not swallow the fence", () => {
    expect(renderAll("some prose\n```\ncode\n```")).toEqual([
      "some prose",
      "```",
      "code",
      "```",
    ]);
  });
});
