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
      "z.ai-anthropic",
      "kimi",
      "kimi-api",
      "kimi-anthropic",
      "kimi-cn",
      "minimax",
      "minimax-api",
      "minimax-anthropic",
      "minimax-cn",
      "deepseek",
      "deepseek-anthropic",
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

describe("first-class providers skip the endpoint step (#211)", () => {
  const provider = (key: string) => MODEL_PROVIDERS.find((p) => p.key === key)!;

  test("Ollama Cloud no longer asks for a base URL", () => {
    expect(provider("ollama").needsBaseUrl).toBeFalsy();
    expect(provider("ollama").modelBaseUrl).toBe("https://ollama.com");
  });

  test("Z.ai and OpenRouter have fixed endpoints", () => {
    expect(provider("z.ai").needsBaseUrl).toBeFalsy();
    expect(provider("openrouter").needsBaseUrl).toBeFalsy();
  });

  test("only custom providers need a base URL", () => {
    for (const p of MODEL_PROVIDERS) {
      if (p.needsBaseUrl) expect(p.isCustom).toBe(true);
    }
  });
});

describe("Anthropic-protocol and region variants (#211)", () => {
  const provider = (key: string) => MODEL_PROVIDERS.find((p) => p.key === key)!;

  test("Anthropic-protocol entries use each provider's documented endpoint", () => {
    expect(provider("z.ai-anthropic").modelBaseUrl).toBe("https://api.z.ai/api/anthropic");
    expect(provider("kimi-anthropic").modelBaseUrl).toBe("https://api.kimi.com/coding/");
    expect(provider("minimax-anthropic").modelBaseUrl).toBe("https://api.minimax.io/anthropic");
    expect(provider("deepseek-anthropic").modelBaseUrl).toBe("https://api.deepseek.com/anthropic");
  });

  test("region variants point at the China hosts", () => {
    expect(provider("kimi-cn").modelBaseUrl).toBe("https://api.moonshot.cn/v1");
    expect(provider("minimax-cn").modelBaseUrl).toBe("https://api.minimaxi.com/v1");
  });

  test("Anthropic-protocol entries are OpenAI-compat false only by customType", () => {
    for (const key of ["z.ai-anthropic", "kimi-anthropic", "minimax-anthropic", "deepseek-anthropic"]) {
      expect(provider(key).customType).toBe("anthropic-compatible");
    }
  });
});
