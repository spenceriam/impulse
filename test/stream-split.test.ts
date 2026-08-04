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
    const split = plan.split;

    expect(split).toEqual({
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

  test("returns null when a single paragraph has no safe boundary", () => {
    expect(splitAtSafeBoundary("para one contin")).toBeNull();
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

  test("carries an incomplete heading or list item forward whole", () => {
    expect(splitAtSafeBoundary("intro line\n### incomplete", { allowLineCut: true })).toEqual({
      frozen: "intro line",
      remainder: "### incomplete",
      kind: "line",
    });
    expect(splitAtSafeBoundary("para one\n\n- first item\n- second item in progr", {
      allowLineCut: true,
    })).toEqual({
      frozen: "para one",
      remainder: "- first item\n- second item in progr",
      kind: "paragraph",
    });
  });
});
