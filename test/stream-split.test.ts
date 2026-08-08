import { describe, expect, test } from "bun:test";
import {
  planStreamingRotation,
  splitAtSafeBoundary,
} from "../src/cli/stream-split.js";

describe("splitAtSafeBoundary", () => {
  test("carries the incomplete final line into the next streaming block", () => {
    const plan = planStreamingRotation({
      raw: "Completed summary.\n\nNext",
      incomingToken: ": tell me which section to expand",
      renderedLines: 12,
      softLimit: 12,
      hardLimit: 24,
    });

    expect(plan.split).toEqual({
      frozen: "Completed summary.",
      remainder: "Next",
      kind: "paragraph",
    });
    expect(plan.nextRaw).toBe("Next: tell me which section to expand");
  });

  test("force-rotates a single long line when soft limit is reached", () => {
    const plan = planStreamingRotation({
      raw: "para one contin",
      incomingToken: "uation",
      renderedLines: 12,
      softLimit: 12,
      hardLimit: 24,
    });

    expect(plan.split).toEqual({
      frozen: "para one contin",
      remainder: "",
      kind: "line",
    });
    expect(plan.nextRaw).toBe("uation");
  });

  test("waits for hard limit before force-rotating multi-line prose without paragraph breaks", () => {
    const softPlan = planStreamingRotation({
      raw: "line one\nline two contin",
      incomingToken: "uation",
      renderedLines: 12,
      softLimit: 12,
      hardLimit: 24,
    });

    expect(softPlan.split).toBeNull();
    expect(softPlan.nextRaw).toBe("line one\nline two continuation");

    const hardPlan = planStreamingRotation({
      raw: "line one\nline two contin",
      incomingToken: "uation",
      renderedLines: 24,
      softLimit: 12,
      hardLimit: 24,
    });

    expect(hardPlan.split).toEqual({
      frozen: "line one",
      remainder: "line two contin",
      kind: "line",
    });
    expect(hardPlan.nextRaw).toBe("line two continuation");
  });

  test("force-rotates at hard limit when no safe boundary exists", () => {
    const plan = planStreamingRotation({
      raw: "| a | b |\n| --- | --- |\n| 1 | 2",
      incomingToken: " next",
      renderedLines: 24,
      softLimit: 12,
      hardLimit: 24,
    });

    expect(plan.split).toEqual({
      frozen: "| a | b |\n| --- | --- |\n| 1 | 2",
      remainder: "",
      kind: "line",
    });
    expect(plan.nextRaw).toBe(" next");
  });

  test("returns null when there is no boundary yet (single paragraph mid-word)", () => {
    expect(splitAtSafeBoundary("para one contin")).toBeNull();
  });

  test("cuts at a single paragraph boundary", () => {
    expect(splitAtSafeBoundary("para one\n\npara two contin")).toEqual({
      frozen: "para one",
      remainder: "para two contin",
      kind: "paragraph",
    });
  });

  test("uses the last paragraph boundary", () => {
    expect(splitAtSafeBoundary("para one\n\npara two\n\npara three contin")).toEqual({
      frozen: "para one\n\npara two",
      remainder: "para three contin",
      kind: "paragraph",
    });
  });

  test("ignores blank lines inside an open code fence", () => {
    expect(splitAtSafeBoundary("text\n\n```ts\ncode\n\nmore")).toEqual({
      frozen: "text",
      remainder: "```ts\ncode\n\nmore",
      kind: "paragraph",
    });
  });

  test("returns null for fence-only content with internal blank lines", () => {
    expect(splitAtSafeBoundary("```ts\na\n\nb")).toBeNull();
    expect(splitAtSafeBoundary("```ts\na\n\nb", { allowLineCut: true })).toBeNull();
  });

  test("line cuts only when explicitly allowed", () => {
    const raw = "1. Item one\n2. Item two contin";
    expect(splitAtSafeBoundary(raw)).toBeNull();
    expect(splitAtSafeBoundary(raw, { allowLineCut: true })).toEqual({
      frozen: "1. Item one",
      remainder: "2. Item two contin",
      kind: "line",
    });
  });

  test("does not line cut through an incomplete table", () => {
    const raw = "| a | b |\n| --- | --- |\n| 1 | 2";
    expect(splitAtSafeBoundary(raw, { allowLineCut: true })).toBeNull();
  });

  test("keeps an open code fence in the mutable remainder", () => {
    expect(splitAtSafeBoundary("intro\n```ts\ncode", { allowLineCut: true })).toEqual({
      frozen: "intro",
      remainder: "```ts\ncode",
      kind: "line",
    });
  });

  test("line-cut skips past a closed fence to the last safe boundary", () => {
    expect(splitAtSafeBoundary("text\n```\ncode\n```\nmore", { allowLineCut: true })).toEqual({
      frozen: "text\n```\ncode\n```",
      remainder: "more",
      kind: "line",
    });
  });

  test("raw ending in a blank run leaves an empty remainder", () => {
    expect(splitAtSafeBoundary("para one\n\n")).toEqual({
      frozen: "para one",
      remainder: "",
      kind: "paragraph",
    });
  });

  test("normalizes carriage returns before splitting", () => {
    expect(splitAtSafeBoundary("para one\r\n\r\npara two contin")).toEqual({
      frozen: "para one",
      remainder: "para two contin",
      kind: "paragraph",
    });
  });

  test("never freezes a whitespace-only prefix", () => {
    expect(splitAtSafeBoundary("   \n\nreal content here")).toBeNull();
  });

  test("never severs a heading from its leading hashes", () => {
    const result = splitAtSafeBoundary("intro\n\n### Head");
    expect(result).not.toBeNull();
    expect(result!.remainder.startsWith("### Head")).toBe(true);
  });

  describe("interleaved-thinking regression (a reasoning burst interrupts mid-line)", () => {
    test("carries an incomplete bold span forward whole instead of splitting it", () => {
      expect(splitAtSafeBoundary("Current version", { allowLineCut: true })).toBeNull();
    });

    test("a heading prefix on its own incomplete line is never orphaned from its text", () => {
      const result = splitAtSafeBoundary("intro line\n### incomplete", { allowLineCut: true });
      expect(result).not.toBeNull();
      expect(result!.frozen).toBe("intro line");
      expect(result!.remainder).toBe("### incomplete");
    });

    test("a list marker mid-item is carried forward with its content, not alone", () => {
      const result = splitAtSafeBoundary(
        "para one\n\n- first item\n- second item in progr",
        { allowLineCut: true }
      );
      expect(result).not.toBeNull();
      expect(result!.frozen).toBe("para one");
      expect(result!.remainder).toBe("- first item\n- second item in progr");
    });

    test("a thinking interrupt mid-table defers entirely rather than truncating rows", () => {
      const raw = "| Safety | Explicit permission prompts";
      expect(splitAtSafeBoundary(raw, { allowLineCut: true })).toBeNull();
    });
  });
});
