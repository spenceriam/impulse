import { describe, expect, test } from "bun:test";
import { modelSupportsVisionCached, setModelCapabilities, clearModelCapabilities } from "../src/api/capabilities.js";

describe("modelSupportsVisionCached key normalization (#133 feedback)", () => {
  test("prefixed session id finds bare-id catalog entry", () => {
    const bare = "vision-test-bare-xyz";
    const prefixed = `prov/${bare}`;
    try {
      setModelCapabilities(bare, {
        vision: true,
        reasoning: false,
        source: "catalog",
      });
      // Discovery warms bare ids; the session/paste guard checks the
      // provider-prefixed id. Lookup must normalize between the two.
      expect(modelSupportsVisionCached(prefixed)).toBe(true);
      expect(modelSupportsVisionCached(bare)).toBe(true);
    } finally {
      clearModelCapabilities(bare);
      clearModelCapabilities(prefixed);
    }
  });

  test("negative catalog entry under bare id is also found via prefixed id", () => {
    const bare = "textonly-test-bare-xyz";
    const prefixed = `prov/${bare}`;
    try {
      setModelCapabilities(bare, {
        vision: false,
        reasoning: false,
        source: "catalog",
      });
      expect(modelSupportsVisionCached(prefixed)).toBe(false);
    } finally {
      clearModelCapabilities(bare);
      clearModelCapabilities(prefixed);
    }
  });
});