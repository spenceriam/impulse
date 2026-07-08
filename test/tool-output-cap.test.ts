import { describe, expect, test } from "bun:test";
import {
  capBashOutputLines,
  capToolResultContent,
  MAX_BASH_LINE_CHARS,
  MAX_TOOL_RESULT_CHARS,
} from "../src/util/tool-output-cap.js";

describe("tool output caps", () => {
  test("capToolResultContent truncates oversized tool results with a retry recipe", () => {
    const raw = "x".repeat(MAX_TOOL_RESULT_CHARS + 5000);
    const capped = capToolResultContent(raw);
    expect(capped.length).toBeLessThan(raw.length);
    expect(capped).toContain("[Output truncated:");
    expect(capped).toContain(`kept the first ${MAX_TOOL_RESULT_CHARS} of ${raw.length} chars`);
    expect(capped).toContain("Retry with a narrower request");
  });

  test("capBashOutputLines enforces per-line and byte limits with an offset recipe", () => {
    const longLine = "a".repeat(MAX_BASH_LINE_CHARS + 500);
    const raw = Array.from({ length: 5 }, () => longLine).join("\n");
    const { output, truncated } = capBashOutputLines(raw, 2000, MAX_BASH_LINE_CHARS, 500);
    expect(truncated).toBe(true);
    expect(output).toContain("[Output truncated:");
    expect(output).toContain("Re-run with offset:");
    expect(output.split("\n")[0]!.length).toBeLessThanOrEqual(MAX_BASH_LINE_CHARS + 1);
  });

  test("capBashOutputLines recipe accounts for a caller-supplied baseOffset", () => {
    const raw = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const { output } = capBashOutputLines(raw, 4, undefined, undefined, 20);
    // Absolute offset (20 + 4 kept), not relative to this slice.
    expect(output).toContain("Re-run with offset: 24");
    expect(output).toContain("Kept lines 21-24");
  });

  test("capBashOutputLines reports keptLines for the line-count cap", () => {
    const raw = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const { keptLines, truncated } = capBashOutputLines(raw, 4);
    expect(keptLines).toBe(4);
    expect(truncated).toBe(true);
  });

  test("capBashOutputLines reports keptLines for the byte cap (fewer than the line cap)", () => {
    const raw = Array.from({ length: 10 }, () => "x".repeat(100)).join("\n");
    const { keptLines, truncated } = capBashOutputLines(raw, 2000, MAX_BASH_LINE_CHARS, 350);
    expect(keptLines).toBeLessThan(10);
    expect(truncated).toBe(true);
  });

  test("capBashOutputLines reports the full line count when nothing is cut", () => {
    const raw = "a\nb\nc";
    const { keptLines, truncated } = capBashOutputLines(raw, 2000);
    expect(keptLines).toBe(3);
    expect(truncated).toBe(false);
  });
});
