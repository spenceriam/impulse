import { describe, expect, test } from "bun:test";
import {
  estimateMessageTokens,
  planHeadBoundary,
  planPruneBySize,
  planTailBoundary,
} from "../src/session/compact.js";

describe("planPruneBySize (#183 phase 1)", () => {
  test("prunes the largest outputs first until the budget is covered", () => {
    const sizes = [
      { index: 0, chars: 1_000 },
      { index: 1, chars: 50_000 },
      { index: 2, chars: 20_000 },
      { index: 3, chars: 500 },
    ];
    const pruned = planPruneBySize(sizes, new Set(), 55_000);
    // 50k covers most of the budget, then 20k pushes it over.
    expect(pruned).toEqual([1, 2]);
  });

  test("protected indices are never pruned", () => {
    const sizes = [
      { index: 0, chars: 99_000 },
      { index: 1, chars: 1_000 },
    ];
    expect(planPruneBySize(sizes, new Set([0]), 50_000)).toEqual([1]);
  });

  test("zero budget prunes nothing", () => {
    expect(planPruneBySize([{ index: 0, chars: 500 }], new Set(), 0)).toEqual([]);
  });
});

describe("planHeadBoundary (#183 phase 2)", () => {
  test("protects the first user message and the assistant reply after it", () => {
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "tool" },
      { role: "assistant" },
    ];
    expect(planHeadBoundary(messages)).toBe(2);
  });

  test("first user message with no reply yet protects just that message", () => {
    expect(planHeadBoundary([{ role: "user" }, { role: "user" }])).toBe(1);
  });

  test("no user message protects nothing", () => {
    expect(planHeadBoundary([{ role: "assistant" }])).toBe(0);
  });
});

describe("planTailBoundary (#183 phase 3)", () => {
  test("keeps the newest messages until the token budget is reached", () => {
    // 10 messages of 100 tokens each, 350-token budget → keep 3 (300).
    const tokens = Array.from({ length: 10 }, () => 100);
    expect(planTailBoundary(tokens, 350)).toBe(7);
  });

  test("a single oversized newest message is still kept", () => {
    expect(planTailBoundary([10, 10, 5_000], 350)).toBe(2);
  });

  test("everything fits when the budget exceeds the total", () => {
    expect(planTailBoundary([10, 10], 350)).toBe(0);
  });

  test("empty input returns 0", () => {
    expect(planTailBoundary([], 350)).toBe(0);
  });
});

describe("estimateMessageTokens", () => {
  test("counts content, reasoning, tool arguments and results", () => {
    const bare = estimateMessageTokens({ content: "x".repeat(350) });
    expect(bare).toBe(100);

    const withTools = estimateMessageTokens({
      content: "",
      tool_calls: [
        {
          tool: "bash",
          arguments: { command: "x".repeat(350) },
          result: { output: "y".repeat(350) },
        },
      ],
    });
    expect(withTools).toBeGreaterThan(100);
  });

  test("empty message is zero, not NaN", () => {
    expect(estimateMessageTokens({})).toBe(0);
  });
});
