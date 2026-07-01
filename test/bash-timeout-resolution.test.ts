import { describe, expect, test } from "bun:test";
import { resolveBashTimeoutMs } from "../src/tools/bash.js";

describe("resolveBashTimeoutMs", () => {
  test("timeout: 0 means no limit", () => {
    expect(resolveBashTimeoutMs(0)).toBeUndefined();
  });

  test("omitted timeout falls back to the 120s default", () => {
    expect(resolveBashTimeoutMs(undefined)).toBe(120_000);
  });

  test("an explicit timeout passes through unchanged", () => {
    expect(resolveBashTimeoutMs(5000)).toBe(5000);
  });
});
