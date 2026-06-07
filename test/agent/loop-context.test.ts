import { describe, expect, test } from "bun:test";
import { SAFETY_MARGIN, CONTEXT_WRAPUP_THRESHOLD } from "../../src/session/compact.js";

describe("context safety constants", () => {
  test("SAFETY_MARGIN is 1.15", () => {
    expect(SAFETY_MARGIN).toBe(1.15);
  });

  test("CONTEXT_WRAPUP_THRESHOLD is 0.80", () => {
    expect(CONTEXT_WRAPUP_THRESHOLD).toBe(0.8);
  });

  test("hard cutoff gate uses safety margin on final estimate", () => {
    const contextWindow = 100_000;
    const finalEstimate = 87_000;
    const finalSafety = Math.ceil(finalEstimate * SAFETY_MARGIN);
    expect(finalSafety).toBeGreaterThanOrEqual(contextWindow);
    expect(finalEstimate).toBeLessThan(contextWindow);
  });

  test("raw estimate below window passes when safety-adjusted is below", () => {
    const contextWindow = 100_000;
    const finalEstimate = 86_000;
    const finalSafety = Math.ceil(finalEstimate * SAFETY_MARGIN);
    expect(finalSafety).toBeLessThan(contextWindow);
  });
});
