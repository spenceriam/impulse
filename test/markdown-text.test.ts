import { describe, expect, test } from "bun:test";
import { MarkdownTextBlock } from "../src/cli/components/markdown-text";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("MarkdownTextBlock", () => {
  test("renders markdown tables as terminal-native boxes on wide terminals", () => {
    const block = new MarkdownTextBlock("  ");
    block.setText("Before\n\n| Tool | Result |\n| --- | --- |\n| grep | ok |\n| glob | ok |\n\nAfter");

    const rendered = block.render(80).map(stripAnsi).join("\n");
    expect(rendered).toContain("┌");
    expect(rendered).toContain("│ Tool");
    expect(rendered).toContain("│ grep");
    expect(rendered).not.toContain("| Tool | Result |");
  });

  test("falls back to stacked records on narrow terminals", () => {
    const block = new MarkdownTextBlock("  ");
    block.setText("| Very long heading | Another long heading |\n| --- | --- |\n| alpha beta gamma | delta epsilon zeta |");

    const rendered = block.render(24).map(stripAnsi).join("\n");
    expect(rendered).toContain("[1]");
    expect(rendered).toContain("Very long heading");
    expect(rendered).toContain("alpha beta");
  });
});
