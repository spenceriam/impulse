import { describe, expect, test } from "bun:test";
import {
  clearModelCache,
  getCachedModelInfos,
  setCachedModelInfos,
} from "../src/cli/model-setup.js";
import type { ModelInfo } from "../src/cli/model-setup.js";

const infos: ModelInfo[] = [
  { id: "model-a", vendor: "test", displayName: "Model A", pickerLine: "Model A" },
];

describe("model cache is keyed by API key", () => {
  test("a different or typo'd key never serves the previous key's model list", () => {
    clearModelCache();
    setCachedModelInfos("provider-x", infos, "sk-valid-key-1");
    expect(getCachedModelInfos("provider-x", "sk-valid-key-1")).toEqual(infos);
    expect(getCachedModelInfos("provider-x", "sk-valid-key-2")).toBeUndefined();
    expect(getCachedModelInfos("provider-x")).toBeUndefined();
  });

  test("changing the key back does not resurrect the stale entry after invalidation", () => {
    clearModelCache();
    setCachedModelInfos("provider-y", infos, "sk-aaa");
    expect(getCachedModelInfos("provider-y", "sk-bbb")).toBeUndefined();
    expect(getCachedModelInfos("provider-y", "sk-aaa")).toEqual(infos);
    clearModelCache("provider-y");
    expect(getCachedModelInfos("provider-y", "sk-aaa")).toBeUndefined();
  });
});
