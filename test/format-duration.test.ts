import { describe, expect, test } from "bun:test";
import { formatDurationMs } from "../src/cli/format-helpers.js";

describe("formatDurationMs", () => {
  test("formats sub-100ms as milliseconds", () => {
    expect(formatDurationMs(99)).toBe("99ms");
    expect(formatDurationMs(0)).toBe("0ms");
  });

  test("formats under 60s with one decimal", () => {
    expect(formatDurationMs(4500)).toBe("4.5s");
  });

  test("formats 60s and over as minutes and seconds", () => {
    expect(formatDurationMs(60_000)).toBe("1m 0s");
    expect(formatDurationMs(160_600)).toBe("2m 40s");
    expect(formatDurationMs(300_000)).toBe("5m 0s");
  });
});
