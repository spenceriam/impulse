import { afterEach, describe, expect, it } from "bun:test";
import {
  clearModelCache,
  getCachedModelInfos,
  setCachedModelInfos,
} from "../src/cli/model-setup";
import type { ModelInfo } from "../src/cli/model-catalog";

const sampleInfo = (id: string): ModelInfo => ({
  id,
  vendor: "Test",
  displayName: id,
  pickerLine: `${id}`,
});

describe("model discovery cache", () => {
  afterEach(() => {
    clearModelCache();
  });

  it("getCachedModelInfos returns undefined when cache is empty", () => {
    setCachedModelInfos("ollama", []);
    expect(getCachedModelInfos("ollama")).toBeUndefined();
  });

  it("getCachedModelInfos returns undefined for unknown provider", () => {
    expect(getCachedModelInfos("unknown-provider")).toBeUndefined();
  });

  it("setCachedModelInfos stores non-empty lists", () => {
    const infos = [sampleInfo("glm-4.7"), sampleInfo("kimi-k2.6")];
    setCachedModelInfos("ollama", infos);
    expect(getCachedModelInfos("ollama")).toEqual(infos);
  });

  it("clearModelCache removes one provider", () => {
    setCachedModelInfos("ollama", [sampleInfo("a")]);
    setCachedModelInfos("openrouter", [sampleInfo("b")]);
    clearModelCache("ollama");
    expect(getCachedModelInfos("ollama")).toBeUndefined();
    expect(getCachedModelInfos("openrouter")).toHaveLength(1);
  });
});
