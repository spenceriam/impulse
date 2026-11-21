import { describe, expect, test } from "bun:test";
import {
  BINARY_LEVELS,
  EFFORT_LEVELS,
  getLevelsForStyle,
  levelToBudgetTokens,
  levelToEffort,
  NO_LEVELS,
  UNKNOWN_REASONING,
} from "../src/api/providers/capabilities.js";
import { mapOllamaReasoningParams } from "../src/api/providers/ollama.js";

describe("unknown is not 'no reasoning' (#210)", () => {
  test("the unknown baseline offers on/off, not off-only", () => {
    expect(UNKNOWN_REASONING.supported).toBe(true);
    expect(UNKNOWN_REASONING.levels).toEqual(BINARY_LEVELS);
  });

  test("a style with no reasoning still yields off only", () => {
    expect(getLevelsForStyle("none")).toEqual(NO_LEVELS);
  });
});

describe("provider-advertised tiers reach the request (#210)", () => {
  test("effort passes unknown tiers through instead of collapsing to medium", () => {
    expect(levelToEffort("max")).toBe("max");
    expect(levelToEffort("xhigh")).toBe("xhigh");
    expect(levelToEffort("medium")).toBe("medium");
    expect(levelToEffort("off")).toBeUndefined();
  });

  test("budget gives extra tiers their own budget instead of the medium default", () => {
    expect(levelToBudgetTokens("high")).toBe(16384);
    expect(levelToBudgetTokens("xhigh")).toBeGreaterThan(levelToBudgetTokens("high")!);
    expect(levelToBudgetTokens("max")).toBeGreaterThan(levelToBudgetTokens("xhigh")!);
    expect(levelToBudgetTokens("off")).toBeUndefined();
  });

  test("ollama clamps an unadvertised tier to high, never down to medium", () => {
    expect(mapOllamaReasoningParams("max").reasoning_effort).toBe("high");
    expect(mapOllamaReasoningParams("medium").reasoning_effort).toBe("medium");
    expect(mapOllamaReasoningParams("off")).toEqual({ reasoning_effort: "none", think: false });
  });
});

describe("baseline level lists are unchanged", () => {
  test("effort and budget keep the four built-ins", () => {
    expect(getLevelsForStyle("effort")).toEqual(EFFORT_LEVELS);
    expect(getLevelsForStyle("budget")).toEqual(EFFORT_LEVELS);
    expect(getLevelsForStyle("binary")).toEqual(BINARY_LEVELS);
  });
});
