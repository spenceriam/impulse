import { describe, expect, test } from "bun:test";
import {
  KNOWN_PROVIDER_KEYS,
  MODEL_PROVIDERS,
  parseProviderChoice,
} from "../src/cli/model-setup.js";

describe("first-class provider entries (#211)", () => {
  const keys = new Set(MODEL_PROVIDERS.map((p) => p.key));

  test("each plan and API variant exists", () => {
    for (const key of [
      "z.ai",
      "z.ai-api",
      "kimi",
      "kimi-api",
      "minimax",
      "deepseek",
    ]) {
      expect(keys.has(key)).toBe(true);
      expect(KNOWN_PROVIDER_KEYS.has(key)).toBe(true);
    }
  });

  test("plan and API variants point at different endpoints", () => {
    const url = (key: string) => MODEL_PROVIDERS.find((p) => p.key === key)!.modelBaseUrl;
    expect(url("z.ai")).toBe("https://api.z.ai/api/coding/paas/v4");
    expect(url("z.ai-api")).toBe("https://api.z.ai/api/paas/v4");
    expect(url("kimi")).toBe("https://api.kimi.com/coding/v1");
    expect(url("kimi-api")).toBe("https://api.moonshot.ai/v1");
  });

  test("plan and API variants never share the same key entry", () => {
    // Same endpoint can be legitimate (MiniMax), same key never is.
    const allKeys = MODEL_PROVIDERS.map((p) => p.key);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  test("every entry has a label and a usable base URL", () => {
    for (const p of MODEL_PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      if (!p.isCustom) expect(p.modelBaseUrl.length).toBeGreaterThan(0);
    }
  });

  test("entries are selectable by key", () => {
    expect(parseProviderChoice("deepseek", "ollama")?.key).toBe("deepseek");
    expect(parseProviderChoice("kimi-api", "ollama")?.key).toBe("kimi-api");
  });
});
