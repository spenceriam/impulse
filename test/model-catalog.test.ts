import { describe, expect, test } from "bun:test";
import {
  defaultContextWindowForModel,
  enrichModelId,
  recordSupportsVision,
  warmVisionCapabilitiesFromCatalog,
  type CatalogData,
  type ModelsDevRecord,
} from "../src/cli/model-catalog.js";
import {
  clearModelCapabilities,
  getModelCapabilities,
  modelSupportsVisionCached,
  setModelCapabilities,
} from "../src/api/capabilities.js";

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

describe("recordSupportsVision (models.dev capability fields)", () => {
  test("glm-5.3-flash attachment:true → vision (regression for #132)", () => {
    const record: ModelsDevRecord = {
      id: "glm-5.3-flash",
      name: "GLM-5.3-Flash",
      family: "glm",
      attachment: true,
    };
    expect(recordSupportsVision(record)).toBe(true);
  });

  test("image modalities input implies vision", () => {
    const record: ModelsDevRecord = {
      id: "some-model",
      modalities: { input: ["text", "image"], output: ["text"] },
    };
    expect(recordSupportsVision(record)).toBe(true);
  });

  test("text-only record is a negative", () => {
    const record: ModelsDevRecord = {
      id: "glm-5.1",
      attachment: false,
      modalities: { input: ["text"], output: ["text"] },
    };
    expect(recordSupportsVision(record)).toBe(false);
  });

  test("record without capability data is unknown (undefined)", () => {
    const record: ModelsDevRecord = { id: "mystery", name: "Mystery" };
    expect(recordSupportsVision(record)).toBeUndefined();
    expect(recordSupportsVision(undefined)).toBeUndefined();
  });
});

describe("warmVisionCapabilitiesFromCatalog", () => {
  const catalog: CatalogData = {
    "ollama-cloud": {
      models: {
        "glm-5.3-flash": {
          id: "glm-5.3-flash",
          name: "GLM-5.3-Flash",
          family: "glm",
          attachment: true,
          reasoning: true,
          limit: { context: 200_000 },
        },
        "glm-5.1": {
          id: "glm-5.1",
          attachment: false,
          limit: { context: 200_000 },
        },
      },
    },
  };

  test("writes catalog vision capability into cache and picker sees it", () => {
    const modelId = "ollama/glm-5.3-flash";
    clearModelCapabilities(modelId);
    try {
      // Pre-seed the poisoned state from #132: a stale heuristic negative.
      setModelCapabilities(modelId, {
        vision: false,
        reasoning: false,
        source: "heuristic",
      });

      warmVisionCapabilitiesFromCatalog([modelId], catalog);

      const cached = getModelCapabilities(modelId);
      expect(cached?.source).toBe("catalog");
      expect(cached?.vision).toBe(true);
      expect(modelSupportsVisionCached(modelId)).toBe(true);
    } finally {
      clearModelCapabilities(modelId);
    }
  });

  test("text-only catalog models get vision:false", () => {
    const modelId = "ollama/glm-5.1";
    clearModelCapabilities(modelId);
    try {
      warmVisionCapabilitiesFromCatalog([modelId], catalog);
      expect(getModelCapabilities(modelId)?.vision).toBe(false);
    } finally {
      clearModelCapabilities(modelId);
    }
  });

  test("never clobbers user-override or provider-api entries", () => {
    const modelId = "ollama/glm-5.3-flash";
    clearModelCapabilities(modelId);
    try {
      setModelCapabilities(modelId, {
        vision: false,
        reasoning: true,
        source: "user-override",
      });

      warmVisionCapabilitiesFromCatalog([modelId], catalog);

      const cached = getModelCapabilities(modelId);
      expect(cached?.source).toBe("user-override");
      expect(cached?.vision).toBe(false);
    } finally {
      clearModelCapabilities(modelId);
    }
  });

  test("models the catalog cannot resolve are skipped", () => {
    const before = getModelCapabilities("ollama/totally-unknown-xyz");
    warmVisionCapabilitiesFromCatalog(["ollama/totally-unknown-xyz"], catalog);
    expect(getModelCapabilities("ollama/totally-unknown-xyz")).toBe(before);
  });
});
