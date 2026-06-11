import { describe, expect, test } from "bun:test";
import {
  capBashOutputLines,
  capToolResultContent,
  MAX_BASH_LINE_CHARS,
  MAX_TOOL_RESULT_CHARS,
} from "../src/util/tool-output-cap.js";

describe("tool output caps", () => {
  test("capToolResultContent truncates oversized tool results", () => {
    const raw = "x".repeat(MAX_TOOL_RESULT_CHARS + 5000);
    const capped = capToolResultContent(raw);
    expect(capped.length).toBeLessThan(raw.length);
    expect(capped).toContain("[output truncated:");
  });

  test("capBashOutputLines enforces per-line and byte limits", () => {
    const longLine = "a".repeat(MAX_BASH_LINE_CHARS + 500);
    const raw = Array.from({ length: 5 }, () => longLine).join("\n");
    const { output, truncated } = capBashOutputLines(raw, 2000, MAX_BASH_LINE_CHARS, 500);
    expect(truncated).toBe(true);
    expect(output).toContain("[Output truncated:");
    expect(output.split("\n")[0]!.length).toBeLessThanOrEqual(MAX_BASH_LINE_CHARS + 1);
  });
});
