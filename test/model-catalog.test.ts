import { describe, expect, test } from "bun:test";
import { enrichModelId } from "../src/cli/model-catalog.js";

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
