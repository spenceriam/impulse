import { describe, expect, test } from "bun:test";
import {
  createDefaultConfig,
  isModelConfigured,
  repairModelExplicitlySet,
} from "../src/util/config.js";

describe("isModelConfigured", () => {
  test("requires modelExplicitlySet and non-empty defaultModel", () => {
    expect(
      isModelConfigured(
        createDefaultConfig({
          defaultModel: "ollama/nemotron-3-ultra",
          modelExplicitlySet: true,
        })
      )
    ).toBe(true);
  });

  test("false when modelExplicitlySet is false despite defaultModel", () => {
    expect(
      isModelConfigured(
        createDefaultConfig({
          defaultModel: "ollama/nemotron-3-ultra",
          modelExplicitlySet: false,
        })
      )
    ).toBe(false);
  });

  test("false when defaultModel is empty regardless of flag", () => {
    expect(
      isModelConfigured(
        createDefaultConfig({
          defaultModel: "",
          modelExplicitlySet: true,
        })
      )
    ).toBe(false);
    expect(
      isModelConfigured(
        createDefaultConfig({
          defaultModel: "   ",
          modelExplicitlySet: true,
        })
      )
    ).toBe(false);
  });
});

describe("repairModelExplicitlySet", () => {
  test("repairs onboarding configs with defaultModel but modelExplicitlySet false", () => {
    const parsed = createDefaultConfig({
      defaultModel: "ollama/nemotron-3-ultra",
      modelExplicitlySet: false,
    });
    repairModelExplicitlySet(
      { defaultModel: "ollama/nemotron-3-ultra", modelExplicitlySet: false },
      parsed
    );
    expect(parsed.modelExplicitlySet).toBe(true);
    expect(isModelConfigured(parsed)).toBe(true);
  });

  test("leaves modelExplicitlySet true unchanged", () => {
    const parsed = createDefaultConfig({
      defaultModel: "ollama/x",
      modelExplicitlySet: true,
    });
    repairModelExplicitlySet({ defaultModel: "ollama/x" }, parsed);
    expect(parsed.modelExplicitlySet).toBe(true);
  });

  test("does not set flag when file has no defaultModel", () => {
    const parsed = createDefaultConfig({ modelExplicitlySet: false });
    repairModelExplicitlySet({}, parsed);
    expect(parsed.modelExplicitlySet).toBe(false);
  });
});
