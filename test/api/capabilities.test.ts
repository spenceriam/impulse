import { describe, expect, test } from "bun:test";
import {
  modelSupportsVisionCached,
  modelSupportsVisionFallback,
  setModelCapabilities,
} from "../../src/api/capabilities.js";

describe("modelSupportsVisionCached", () => {
  test("returns heuristic for unknown models without async probe", () => {
    expect(modelSupportsVisionCached("gpt-4o-mini")).toBe(true);
    expect(modelSupportsVisionCached("llama-3.1-8b")).toBe(false);
  });

  test("returns cached value when set", () => {
    setModelCapabilities("test-vision-model-xyz", {
      vision: true,
      reasoning: false,
      source: "user-override",
    });
    expect(modelSupportsVisionCached("test-vision-model-xyz")).toBe(true);

    setModelCapabilities("test-text-only-xyz", {
      vision: false,
      reasoning: false,
      source: "user-override",
    });
    expect(modelSupportsVisionCached("test-text-only-xyz")).toBe(false);
  });

  test("fallback patterns match modelSupportsVisionFallback", () => {
    expect(modelSupportsVisionCached("glm-4.6v")).toBe(
      modelSupportsVisionFallback("glm-4.6v")
    );
  });
});
