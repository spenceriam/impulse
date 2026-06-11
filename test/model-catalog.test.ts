import { describe, expect, test } from "bun:test";
import { defaultContextWindowForModel, enrichModelId } from "../src/cli/model-catalog.js";

describe("defaultContextWindowForModel", () => {
  test("uses 128k for typical flagship models", () => {
    expect(defaultContextWindowForModel("openai/gpt-4o")).toBe(128_000);
    expect(defaultContextWindowForModel("anthropic/claude-3-5-haiku")).toBe(128_000);
  });

  test("uses 200k for extended-context claude families", () => {
    expect(defaultContextWindowForModel("anthropic/claude-sonnet-4")).toBe(200_000);
  });

  test("uses family-specific defaults", () => {
    expect(defaultContextWindowForModel("google/gemini-2.0-flash")).toBe(1_000_000);
    expect(defaultContextWindowForModel("openai/gpt-3.5-turbo")).toBe(32_768);
  });
});

describe("model catalog context resolution", () => {
  test("prefers provider API context_length over models.dev context", () => {
    const catalog = {
      openrouter: {
        models: {
          "vendor/model-x": {
            id: "vendor/model-x",
            name: "Model X",
            family: "vendor",
            limit: { context: 200_000 },
          },
        },
      },
    };

    const info = enrichModelId(
      "openrouter",
      "openrouter/vendor/model-x",
      catalog,
      { id: "vendor/model-x", context_length: 1_000_000 }
    );

    expect(info.contextTokens).toBe(1_000_000);
  });

  test("falls back to a very close models.dev match", () => {
    const catalog = {
      "the-grid-ai": {
        models: {
          "code-max": {
            id: "code-max",
            name: "Code Max",
            family: "code",
            limit: { context: 1_000_000 },
          },
        },
      },
    };

    const info = enrichModelId("custom-grid", "code_max", catalog);

    expect(info.contextTokens).toBe(1_000_000);
  });

  test("does not fuzzy match broad family names", () => {
    const catalog = {
      openai: {
        models: {
          "gpt-4.1-long": {
            id: "gpt-4.1-long",
            name: "GPT 4.1 Long",
            family: "openai",
            limit: { context: 1_000_000 },
          },
        },
      },
    };

    const info = enrichModelId("openai", "gpt-4", catalog);

    expect(info.contextTokens).toBeUndefined();
  });
});
