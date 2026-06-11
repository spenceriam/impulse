import { describe, expect, test } from "bun:test";
import {
  applySafetyMargin,
  computeContextPct,
  estimateRequestTokens,
  resolveFooterContextTokens,
  SESSION_BASE_OVERHEAD_TOKENS,
} from "../../src/session/token-estimate.js";
import { SAFETY_MARGIN, CONTEXT_WRAPUP_THRESHOLD } from "../../src/session/compact.js";

describe("token-estimate", () => {
  test("computeContextPct clamps to 0-1", () => {
    expect(computeContextPct(50_000, 100_000)).toBe(0.5);
    expect(computeContextPct(150_000, 100_000)).toBe(1);
  });

  test("applySafetyMargin uses SAFETY_MARGIN constant", () => {
    expect(applySafetyMargin(100_000, SAFETY_MARGIN)).toBe(
      Math.ceil(100_000 * SAFETY_MARGIN)
    );
  });

  test("resolveFooterContextTokens prefers prompt_tokens only", () => {
    expect(
      resolveFooterContextTokens({ promptTokens: 42_000, estimatedTokens: 50_000 })
    ).toBe(42_000);
    expect(
      resolveFooterContextTokens({ estimatedTokens: 50_000 })
    ).toBe(50_000);
  });

  test("hard cutoff gate: safety-adjusted estimate at or above window triggers", () => {
    const contextWindow = 100_000;
    const finalEstimate = 87_000;
    const finalSafety = applySafetyMargin(finalEstimate, SAFETY_MARGIN);
    expect(finalSafety).toBeGreaterThanOrEqual(contextWindow);
    expect(finalEstimate).toBeLessThan(contextWindow);
  });

  test("wrap-up threshold constant", () => {
    expect(CONTEXT_WRAPUP_THRESHOLD).toBe(0.8);
  });

  test("estimateRequestTokens includes tools in payload", () => {
    const without = estimateRequestTokens([{ role: "user", content: "hi" }], []);
    const withTools = estimateRequestTokens(
      [{ role: "user", content: "hi" }],
      [{ type: "function", function: { name: "bash", description: "run", parameters: {} } }]
    );
    expect(withTools).toBeGreaterThan(without);
  });

  test("SESSION_BASE_OVERHEAD_TOKENS is positive", () => {
    expect(SESSION_BASE_OVERHEAD_TOKENS).toBeGreaterThan(0);
  });
});
