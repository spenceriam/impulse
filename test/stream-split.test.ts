import { describe, expect, test } from "bun:test";
import { splitAtSafeBoundary } from "../src/cli/stream-split.js";

describe("splitAtSafeBoundary", () => {
  test("returns null when there is no boundary yet (single paragraph mid-word)", () => {
    expect(splitAtSafeBoundary("para one contin")).toBeNull();
  });

  test("cuts at a single paragraph boundary", () => {
    const result = splitAtSafeBoundary("para one\n\npara two contin");
    expect(result).toEqual({
      frozen: "para one",
      remainder: "para two contin",
      kind: "paragraph",
    });
  });

  test("cuts at the last paragraph boundary when multiple exist", () => {
    const result = splitAtSafeBoundary("para one\n\npara two\n\npara three contin");
    expect(result).toEqual({
      frozen: "para one\n\npara two",
      remainder: "para three contin",
      kind: "paragraph",
    });
  });

  test("ignores a blank line inside an open code fence, uses the earlier boundary", () => {
    const result = splitAtSafeBoundary("text\n\n```ts\ncode\n\nmore");
    expect(result).toEqual({
      frozen: "text",
      remainder: "```ts\ncode\n\nmore",
      kind: "paragraph",
    });
  });

  test("returns null for fence-only content with internal blank lines", () => {
    expect(splitAtSafeBoundary("```ts\na\n\nb")).toBeNull();
    expect(splitAtSafeBoundary("```ts\na\n\nb", { allowLineCut: true })).toBeNull();
  });

  test("does not line-cut without allowLineCut", () => {
    expect(splitAtSafeBoundary("1. Item one\n2. Item two contin")).toBeNull();
  });

  test("line-cuts at the last complete line when allowLineCut is set", () => {
    const result = splitAtSafeBoundary("1. Item one\n2. Item two contin", { allowLineCut: true });
    expect(result).toEqual({
      frozen: "1. Item one",
      remainder: "2. Item two contin",
      kind: "line",
    });
  });

  test("refuses a line-cut inside an incomplete streaming table", () => {
    const raw = "| a | b |\n| --- | --- |\n| 1 | 2";
    expect(splitAtSafeBoundary(raw, { allowLineCut: true })).toBeNull();
  });

  test("refuses a line-cut inside an open fence, but cuts before the fence opener", () => {
    const result = splitAtSafeBoundary("intro\n```ts\ncode", { allowLineCut: true });
    expect(result).toEqual({
      frozen: "intro",
      remainder: "```ts\ncode",
      kind: "line",
    });
  });

  test("line-cut skips past a closed fence to the last safe boundary", () => {
    const result = splitAtSafeBoundary("text\n```\ncode\n```\nmore", { allowLineCut: true });
    expect(result).toEqual({
      frozen: "text\n```\ncode\n```",
      remainder: "more",
      kind: "line",
    });
  });

  test("raw ending in a blank run leaves an empty remainder", () => {
    const result = splitAtSafeBoundary("para one\n\n");
    expect(result).toEqual({
      frozen: "para one",
      remainder: "",
      kind: "paragraph",
    });
  });

  test("normalizes CRLF and CR before splitting", () => {
    const result = splitAtSafeBoundary("para one\r\n\r\npara two contin");
    expect(result).toEqual({
      frozen: "para one",
      remainder: "para two contin",
      kind: "paragraph",
    });
  });

  test("returns null when the only candidate would freeze a whitespace-only prefix", () => {
    expect(splitAtSafeBoundary("   \n\nreal content here")).toBeNull();
  });

  test("never severs a heading from its leading hashes", () => {
    const result = splitAtSafeBoundary("intro\n\n### Head");
    expect(result).not.toBeNull();
    expect(result!.remainder.startsWith("### Head")).toBe(true);
  });

  describe("interleaved-thinking regression (a reasoning burst interrupts mid-line)", () => {
    // Reproduces the reported bug: a thinking delta arriving between content
    // chunks used to hard-finalize the stream at whatever character the last
    // chunk ended on, tearing bold spans/headings/list markers/tables in half.
    // finalizeStreamingAtSafeBoundary always calls with allowLineCut: true so
    // the cut lands on the last *complete* line instead.

    test("carries an incomplete bold span forward whole instead of splitting it", () => {
      const raw = "Current version";
      const result = splitAtSafeBoundary(raw, { allowLineCut: true });
      // No complete line exists yet at all — must defer, not cut mid-token.
      expect(result).toBeNull();
    });

    test("a heading prefix on its own incomplete line is never orphaned from its text", () => {
      const raw = "intro line\n### incomplete";
      const result = splitAtSafeBoundary(raw, { allowLineCut: true });
      expect(result).not.toBeNull();
      expect(result!.frozen).toBe("intro line");
      expect(result!.remainder).toBe("### incomplete");
    });

    test("a list marker mid-item is carried forward with its content, not alone", () => {
      const raw = "para one\n\n- first item\n- second item in progr";
      const result = splitAtSafeBoundary(raw, { allowLineCut: true });
      expect(result).not.toBeNull();
      // Prefers the paragraph boundary; the in-progress list item stays intact downstream.
      expect(result!.frozen).toBe("para one");
      expect(result!.remainder).toBe("- first item\n- second item in progr");
    });

    test("a thinking interrupt mid-table defers entirely rather than truncating rows", () => {
      const raw = "| Safety | Explicit permission prompts";
      expect(splitAtSafeBoundary(raw, { allowLineCut: true })).toBeNull();
    });
  });
});
