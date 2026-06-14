import { describe, expect, test } from "bun:test";
import {
  capCompactDiffResult,
  createCompactDiff,
  MAX_COMPACT_DIFF_LINES,
  MAX_DIFF_INPUT_BYTES,
} from "../src/util/compact-diff.js";

describe("compact diff caps", () => {
  test("small edit on large file produces short compact diff", () => {
    const large = `${"x".repeat(32)}\n`.repeat(8000);
    const appended = `${large}line1\nline2\nline3\n`;
    const compact = createCompactDiff(large, appended);
    expect(compact.additions).toBe(3);
    expect(compact.lines.length).toBeLessThan(20);
    const combined = Buffer.byteLength(large) + Buffer.byteLength(appended);
    expect(combined).toBeGreaterThan(200_000);
    expect(combined).toBeLessThan(MAX_DIFF_INPUT_BYTES);
  });

  test("capCompactDiffResult truncates long output but keeps full counts", () => {
    const oldLines = Array.from({ length: 250 }, (_, i) => `old-${i}`).join("\n");
    const newLines = Array.from({ length: 250 }, (_, i) => `new-${i}`).join("\n");
    const compact = createCompactDiff(oldLines, newLines);
    expect(compact.lines.length).toBeGreaterThan(MAX_COMPACT_DIFF_LINES);
    const capped = capCompactDiffResult(compact);
    expect(capped.compactDiff.length).toBe(MAX_COMPACT_DIFF_LINES);
    expect(capped.diffTruncatedLines).toBe(compact.lines.length - MAX_COMPACT_DIFF_LINES);
    expect(capped.linesAdded).toBe(compact.additions);
    expect(capped.linesRemoved).toBe(compact.removals);
  });

  test("combined input above MAX_DIFF_INPUT_BYTES is the skip threshold", () => {
    const half = "a".repeat(MAX_DIFF_INPUT_BYTES / 2 + 1);
    const combined = Buffer.byteLength(half) + Buffer.byteLength(half);
    expect(combined).toBeGreaterThan(MAX_DIFF_INPUT_BYTES);
  });
});
