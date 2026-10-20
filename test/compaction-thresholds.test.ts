import { describe, expect, test } from "bun:test";
import {
  COMPACT_TRIGGER_THRESHOLD,
  resolveCompactionThreshold,
  resolveCompactUsage,
} from "../src/util/compaction-thresholds.js";

describe("resolveCompactionThreshold (#182)", () => {
  test("default when no model or no overrides", () => {
    expect(resolveCompactionThreshold({})).toBe(COMPACT_TRIGGER_THRESHOLD);
    expect(
      resolveCompactionThreshold({ model: "ollama/deepseek-v4.1-flash" })
    ).toBe(COMPACT_TRIGGER_THRESHOLD);
  });

  test("user threshold is the fallback when the model doesn't match", () => {
    expect(
      resolveCompactionThreshold({
        model: "openrouter/other-model",
        userThreshold: 0.75,
        modelThresholds: { "glm-5.2": 0.4 },
      })
    ).toBe(0.75);
  });

  test("substring match on the model id", () => {
    expect(
      resolveCompactionThreshold({
        model: "ollama/glm-5.2-32b",
        modelThresholds: { "glm-5.2": 0.4 },
      })
    ).toBe(0.4);
  });

  test("longest substring wins over a shorter match", () => {
    expect(
      resolveCompactionThreshold({
        model: "provider/claude-sonnet-4.5",
        modelThresholds: { "claude": 0.7, "claude-sonnet": 0.35 },
      })
    ).toBe(0.35);
  });
});

describe("resolveCompactUsage (#182)", () => {
  test("prefers provider-reported tokens", () => {
    const result = resolveCompactUsage({
      providerTokens: 600_000,
      estimatedTokens: 100_000,
      contextWindow: 1_000_000,
    });
    expect(result.usage).toBeCloseTo(0.6);
    expect(result.source).toBe("provider");
  });

  test("falls back to the heuristic estimate when provider tokens are missing or zero", () => {
    const missing = resolveCompactUsage({
      providerTokens: undefined,
      estimatedTokens: 700_000,
      contextWindow: 1_000_000,
    });
    expect(missing.usage).toBeCloseTo(0.7);
    expect(missing.source).toBe("estimate");

    const zero = resolveCompactUsage({
      providerTokens: 0,
      estimatedTokens: 700_000,
      contextWindow: 1_000_000,
    });
    expect(zero.source).toBe("estimate");
  });
});
