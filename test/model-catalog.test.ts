import { describe, expect, it } from "bun:test";
import {
  CATALOG_ALIASES,
  enrichModelId,
  formatContextK,
  formatModelDate,
  formatModelPickerLine,
  fallbackModelInfosFromIds,
  sortModelInfos,
  vendorLabel,
  type ModelsDevRecord,
} from "../src/cli/model-catalog";

const OLLAMA_CLOUD_FIXTURE: Record<string, ModelsDevRecord> = {
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    name: "deepseek v4 pro",
    family: "deepseek",
    release_date: "2026-04-23",
    limit: { context: 1_000_000 },
  },
  "kimi-k2.6": {
    id: "kimi-k2.6",
    name: "kimi k2.6",
    family: "kimi",
    release_date: "2026-04-19",
    limit: { context: 262_144 },
  },
  "glm-4.7": {
    id: "glm-4.7",
    name: "glm 4.7",
    family: "glm",
    release_date: "2025-12-21",
    limit: { context: 203_000 },
  },
};

const FIXTURE_CATALOG = {
  "ollama-cloud": { name: "Ollama Cloud", models: OLLAMA_CLOUD_FIXTURE },
  openrouter: {
    name: "OpenRouter",
    models: {
      "anthropic/claude-sonnet-4.5": {
        id: "anthropic/claude-sonnet-4.5",
        name: "Claude Sonnet 4.5 (latest)",
        limit: { context: 200_000 },
        release_date: "2025-09-29",
      },
    },
  },
};

describe("model-catalog", () => {
  it("maps ollama impulse key to ollama-cloud bucket", () => {
    expect(CATALOG_ALIASES.ollama).toBe("ollama-cloud");
    expect(CATALOG_ALIASES.openrouter).toBe("openrouter");
  });

  it("vendorLabel maps glm family to Zhipu", () => {
    expect(vendorLabel("glm")).toBe("Zhipu");
    expect(vendorLabel("kimi")).toBe("Moonshot");
    expect(vendorLabel("deepseek-thinking")).toBe("DeepSeek");
  });

  it("enriches Ollama Cloud ids with vendor, ctx, and added date", () => {
    for (const id of Object.keys(OLLAMA_CLOUD_FIXTURE)) {
      const info = enrichModelId("ollama", id, FIXTURE_CATALOG);
      expect(info.id).toBe(id);
      expect(info.vendor).not.toBe("—");
      expect(info.contextTokens).toBeGreaterThan(0);
      expect(info.addedAt).toBeDefined();
      expect(info.pickerLine).toContain("Ctx:");
      expect(info.pickerLine).toContain("Added:");
      expect(info.pickerLine).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    }
  });

  it("enriches OpenRouter path ids with vendor from path segment", () => {
    const info = enrichModelId(
      "openrouter",
      "anthropic/claude-sonnet-4.5",
      FIXTURE_CATALOG
    );
    expect(info.vendor).toBe("Anthropic");
    expect(info.displayName).toContain("Claude");
    expect(info.contextTokens).toBe(200_000);
  });

  it("formatModelPickerLine uses Vendor/Name (id) | Ctx | Added", () => {
    const line = formatModelPickerLine({
      vendor: "Zhipu",
      displayName: "glm 4.7",
      id: "glm-4.7",
      contextTokens: 203_000,
      addedAt: new Date("2025-12-21"),
    });
    expect(line).toBe(
      "Zhipu/glm 4.7 (glm-4.7) | Ctx: 203k | Added: 12/21/2025"
    );
  });

  it("sortModelInfos orders by addedAt descending", () => {
    const a = enrichModelId("ollama", "glm-4.7", FIXTURE_CATALOG);
    const b = enrichModelId("ollama", "kimi-k2.6", FIXTURE_CATALOG);
    const c = enrichModelId("ollama", "deepseek-v4-pro", FIXTURE_CATALOG);
    const sorted = sortModelInfos([a, b, c]);
    expect(sorted[0]!.id).toBe("deepseek-v4-pro");
    expect(sorted[1]!.id).toBe("kimi-k2.6");
    expect(sorted[2]!.id).toBe("glm-4.7");
  });

  it("formatContextK abbreviates millions and thousands", () => {
    expect(formatContextK(1_000_000)).toBe("1m");
    expect(formatContextK(200_000)).toBe("200k");
  });

  it("formatModelDate returns mm/dd/yyyy", () => {
    expect(formatModelDate(new Date("2026-04-23"))).toBe("04/23/2026");
  });

  it("fallbackModelInfosFromIds builds picker rows without catalog", () => {
    const infos = fallbackModelInfosFromIds(["alpha", "beta"]);
    expect(infos).toHaveLength(2);
    expect(infos[0]!.id).toBe("alpha");
    expect(infos[0]!.pickerLine).toContain("alpha");
  });
});
