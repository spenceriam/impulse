import { afterEach, describe, expect, test } from "bun:test";
import {
  advertisedReasoningLevels,
  clearReasoningLevels,
  EFFORT_LEVELS,
  getReasoningLevelsForModel,
  mergeReasoningLevels,
  setReasoningLevelsForModel,
} from "../src/api/providers/capabilities.js";
import { load, save } from "../src/util/config.js";

describe("advertisedReasoningLevels (#147)", () => {
  test("keeps tiers beyond the built-in set", () => {
    expect(advertisedReasoningLevels(["low", "medium", "high", "xhigh", "max"])).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  test("lowercases and dedupes", () => {
    expect(advertisedReasoningLevels(["High", "high", "MAX"])).toEqual(["high", "max"]);
  });

  test("ignores junk, non-strings, and non-tier parameters", () => {
    expect(advertisedReasoningLevels(["tools", "temperature", 42, null, "  "])).toEqual([]);
    expect(advertisedReasoningLevels(undefined)).toEqual([]);
    expect(advertisedReasoningLevels("high")).toEqual([]);
  });
});

describe("mergeReasoningLevels (#147)", () => {
  test("baseline first, extras appended, no duplicates", () => {
    expect(mergeReasoningLevels(EFFORT_LEVELS, ["high", "xhigh"])).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("always starts with off", () => {
    expect(mergeReasoningLevels(["low", "medium"], ["max"])).toEqual([
      "off",
      "low",
      "medium",
      "max",
    ]);
  });
});

describe("per-model level registry (#147)", () => {
  afterEach(() => clearReasoningLevels());

  test("stores and resolves levels case-insensitively", () => {
    setReasoningLevelsForModel("openrouter/Anthropic/Claude-X", ["off", "max"]);
    expect(getReasoningLevelsForModel("openrouter/anthropic/claude-x")).toEqual(["off", "max"]);
  });

  test("unknown model has no entry", () => {
    expect(getReasoningLevelsForModel("nope")).toBeUndefined();
  });
});

describe("config accepts discovered tiers (#147)", () => {
  test("a level outside the built-in set round-trips through save/load", async () => {
    const config = await load();
    const previous = config.reasoningLevel;
    try {
      config.reasoningLevel = "xhigh";
      await save(config);
      const reloaded = await load({ refresh: true });
      expect(reloaded.reasoningLevel).toBe("xhigh");
    } finally {
      config.reasoningLevel = previous;
      await save(config);
    }
  });
});
