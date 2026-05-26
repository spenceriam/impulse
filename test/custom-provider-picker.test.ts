import { describe, expect, test } from "bun:test";
import {
  listConfiguredCustomProviderKeys,
  resolveCustomProviderOption,
} from "../src/cli/model-setup.js";
import type { Config } from "../src/util/config.js";

describe("custom provider picker helpers", () => {
  test("listConfiguredCustomProviderKeys excludes built-in providers", () => {
    const config = {
      providers: {
        ollama: { apiKey: "k" },
        "my-api": { apiKey: "k2", type: "anthropic-compatible" as const },
      },
    } as Config;
    expect(listConfiguredCustomProviderKeys(config)).toEqual(["my-api"]);
  });

  test("resolveCustomProviderOption picks anthropic template from stored type", () => {
    const config = {
      providers: {
        "my-api": { apiKey: "k", type: "anthropic-compatible" as const },
      },
    } as Config;
    const opt = resolveCustomProviderOption("my-api", config);
    expect(opt.key).toBe("my-api");
    expect(opt.customType).toBe("anthropic-compatible");
    expect(opt.modelBaseUrl).toContain("anthropic");
  });
});
