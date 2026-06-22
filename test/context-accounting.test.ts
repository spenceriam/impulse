import { describe, expect, test } from "bun:test";
import { resolveFooterContextUsage } from "../src/session/token-estimate.js";

describe("resolveFooterContextUsage", () => {
  test("prefers provider prompt tokens", () => {
    expect(resolveFooterContextUsage({ promptTokens: 123, estimatedTokens: 999 })).toEqual({
      tokens: 123,
      source: "provider",
    });
  });

  test("falls back to estimates", () => {
    expect(resolveFooterContextUsage({ promptTokens: undefined, estimatedTokens: 999 })).toEqual({
      tokens: 999,
      source: "estimate",
    });
  });
});
