import { afterEach, describe, expect, test } from "bun:test";
import {
  discoverOllamaReasoning,
  extractExplicitMaxOutputTokens,
  formatReasoningLevelForDisplay,
} from "../src/api/providers/capabilities";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("discoverOllamaReasoning fallback heuristic", () => {
  test("labels binary reasoning as thinking for display", () => {
    const binary = { supported: true, style: "binary" as const, levels: ["off", "medium" as const] };
    const effort = { supported: true, style: "effort" as const, levels: ["off", "low", "medium", "high" as const] };

    expect(formatReasoningLevelForDisplay("medium", binary)).toBe("thinking");
    expect(formatReasoningLevelForDisplay("off", binary)).toBe("off");
    expect(formatReasoningLevelForDisplay("medium", effort)).toBe("medium");
  });

  test("extracts explicit max output tokens when providers expose them", () => {
    expect(extractExplicitMaxOutputTokens({ limits: { max_output_tokens: 64000 } })).toBe(64000);
    expect(extractExplicitMaxOutputTokens({ data: [{ id: "x" }, { max_completion_tokens: 8192 }] })).toBe(8192);
    expect(extractExplicitMaxOutputTokens({ details: { context_length: 200000 } })).toBeUndefined();
  });

  test("stays conservative for deepseek-v4-pro when API metadata is unavailable", async () => {
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const capability = await discoverOllamaReasoning("https://ollama.com", "deepseek-v4-pro");
    expect(capability.supported).toBe(false);
    expect(capability.levels).toEqual(["off"]);
  });

  test("still enables known reasoning families without API metadata", async () => {
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const capability = await discoverOllamaReasoning("https://ollama.com", "deepseek-r1:70b");
    expect(capability.supported).toBe(true);
    expect(capability.levels).toEqual(["off", "medium"]);
  });
});
