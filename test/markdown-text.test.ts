import { describe, expect, test } from "bun:test";
import { MarkdownTextBlock } from "../src/cli/components/markdown-text.js";
import { visibleWidth } from "@mariozechner/pi-tui";

const BOLD = "\x1b[1m";

function renderLine(markdown: string): string {
  const block = new MarkdownTextBlock("");
  block.setText(markdown);
  const lines = block.render(80);
  return lines[0] ?? "";
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
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

describe("MarkdownTextBlock table transitions", () => {
  test("renders paragraph, list, code, and a second table after a table", () => {
    const block = new MarkdownTextBlock("");
    block.setText([
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | one |",
      "After the first table.",
      "- list item remains a list",
      "```ts",
      "const ok = true;",
      "```",
      "| A | B | C | D | E | F |",
      "| --- | --- | --- | --- | --- | --- |",
      "| 1 | 2 | 3 | 4 | 5 | 6 |",
    ].join("\n"));

    const lines = block.render(30);
    const plain = lines.map(stripAnsi);
    expect(plain).toContain("After the first table.");
    expect(plain.some((line) => line.startsWith("- list item remains"))).toBe(true);
    expect(plain).toContain("```ts");
    expect(plain).toContain("const ok = true;");
    expect(plain).toContain("[1]");
    expect(lines.every((line) => visibleWidth(stripAnsi(line)) <= 30)).toBe(true);
  });

  test("chooses layout independently for each completed table", () => {
    const block = new MarkdownTextBlock("");
    block.setText([
      "| A | B | C | D | E | F |",
      "| --- | --- | --- | --- | --- | --- |",
      "| 1 | 2 | 3 | 4 | 5 | 6 |",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | one |",
    ].join("\n"));

    const plain = block.render(30).map(stripAnsi);
    expect(plain).toContain("[1]");
    expect(plain.some((line) => line.startsWith("┌") && line.includes("┬"))).toBe(true);
  });

  test("an incomplete streaming table becomes a table without stale layout", () => {
    const block = new MarkdownTextBlock("");
    block.setText("| Name | Value |\n| --- | --- |");
    expect(block.render(50).map(stripAnsi)).toContain("| Name | Value |");

    block.setText("| Name | Value |\n| --- | --- |\n| alpha | one |");
    const complete = block.render(50).map(stripAnsi);
    expect(complete.some((line) => line.startsWith("┌"))).toBe(true);
    expect(complete).not.toContain("| Name | Value |");
  });

  test("resets ANSI state before content following a table", () => {
    const block = new MarkdownTextBlock("");
    block.setText([
      "| Name | Value |",
      "| --- | --- |",
      "| **alpha** | `one` |",
      "After table",
    ].join("\n"));

    const lines = block.render(80);
    const afterIndex = lines.findIndex((line) => stripAnsi(line) === "After table");
    expect(afterIndex).toBeGreaterThan(0);
    expect(lines[afterIndex - 1]?.endsWith("\x1b[0m")).toBe(true);
    expect(lines[afterIndex]).toBe("After table");
  });
});
