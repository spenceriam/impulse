import { describe, expect, test } from "bun:test";
import {
  ThinkingBlock,
  formatThoughtSummary,
  isThinkingBlock,
} from "../src/cli/components/thinking-block.js";

describe("formatThoughtSummary", () => {
  test("includes duration when provided", () => {
    expect(formatThoughtSummary(1250)).toBe("Thought for 1.3s");
  });

  test("falls back without duration", () => {
    expect(formatThoughtSummary()).toBe("Thought");
  });
});

describe("ThinkingBlock", () => {
  test("placeholder then finalize collapses", () => {
    const block = new ThinkingBlock();
    block.setPlaceholder();
    expect(block.render(80)[0]).toContain("Thinking...");
    block.finalize(500);
    expect(block.render(80)[0]).toContain("Thought for");
    expect(block.render(80)[0]).not.toContain("▶");
  });

  test("placeholder accumulates content for expand after finalize", () => {
    const block = new ThinkingBlock();
    block.setPlaceholder();
    block.appendContent("hidden reasoning");
    expect(block.render(80)[0]).toContain("Thinking...");
    block.finalize(800);
    block.setExpanded(true);
    const lines = block.render(80);
    expect(lines.some((l) => l.includes("hidden reasoning"))).toBe(true);
  });

  test("expanded shows body after finalize", () => {
    const block = new ThinkingBlock();
    block.setText("line one");
    block.finalize(2000);
    expect(block.render(80)[0]).not.toContain("▶");
    block.setExpanded(true);
    const lines = block.render(80);
    expect(lines.some((l) => l.includes("line one"))).toBe(true);
    expect(lines[0]).toContain("Thinking:");
    expect(lines[0]).not.toContain("▼");
  });

  test("isThinkingBlock type guard", () => {
    const block = new ThinkingBlock();
    expect(isThinkingBlock(block)).toBe(true);
    expect(isThinkingBlock({ invalidate: () => {}, render: () => [] })).toBe(false);
  });
});