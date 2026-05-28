import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../src/util/config";

describe("createDefaultConfig", () => {
  test("applies schema defaults for empty overrides", () => {
    const cfg = createDefaultConfig({});
    expect(cfg.maxOutputTokens).toBe(32000);
    expect(cfg.reasoningLevel).toBe("medium");
    expect(cfg.thinking).toBe(true);
    expect(cfg.experimental).toEqual({ advisor: false });
    expect(cfg.defaultMode).toBe("AGENT");
    expect(cfg.providers).toEqual({});
  });

  test("merges overrides without dropping defaults", () => {
    const cfg = createDefaultConfig({ defaultProvider: "openai" });
    expect(cfg.defaultProvider).toBe("openai");
    expect(cfg.maxOutputTokens).toBe(32000);
    expect(cfg.reasoningLevel).toBe("medium");
  });
});
