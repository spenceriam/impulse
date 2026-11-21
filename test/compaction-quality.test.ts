import { describe, expect, test } from "bun:test";
import { buildFallbackSummary } from "../src/session/compact.js";
import { extractCachedTokens, parseOpenAIUsage, toApiUsageFields } from "../src/api/usage-helpers.js";

describe("deterministic fallback summary (#184)", () => {
  const messages = [
    { role: "user", content: "Fix the auth redirect loop", timestamp: "" },
    {
      role: "assistant",
      content: "",
      timestamp: "",
      tool_calls: [
        {
          tool: "file_edit",
          arguments: { path: "src/auth/redirect.ts" },
          result: { output: "edited" },
        },
      ],
    },
    { role: "assistant", content: "Updated the redirect guard in src/auth/redirect.ts", timestamp: "" },
  ] as never;

  test("keeps the goal, touched files, and last reply", () => {
    const summary = buildFallbackSummary(messages);
    expect(summary).toContain("Fix the auth redirect loop");
    expect(summary).toContain("src/auth/redirect.ts");
    expect(summary).toContain("Updated the redirect guard");
  });

  test("is honest when there is nothing to summarize", () => {
    const summary = buildFallbackSummary([]);
    expect(summary).toContain("no user message captured");
    expect(summary).toContain("no assistant reply captured");
  });
});

describe("usage mapping across provider shapes (#194)", () => {
  test("OpenAI prompt_tokens_details.cached_tokens", () => {
    expect(
      extractCachedTokens({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } })
    ).toBe(80);
  });

  test("missing cache details map to 0, not undefined", () => {
    expect(extractCachedTokens({ prompt_tokens: 100 })).toBe(0);
    expect(extractCachedTokens(null)).toBe(0);
  });

  test("DeepSeek-style top-level cache hits are mapped", () => {
    // DeepSeek reports prompt_cache_hit_tokens alongside prompt_tokens.
    const parsed = parseOpenAIUsage({
      prompt_tokens: 1000,
      completion_tokens: 10,
      total_tokens: 1010,
      prompt_cache_hit_tokens: 600,
    });
    expect(parsed?.promptTokens).toBe(1000);
    expect(parsed?.cachedTokens).toBe(600);
  });

  test("nested cached_tokens wins over the top-level field when both exist", () => {
    expect(
      extractCachedTokens({
        prompt_tokens_details: { cached_tokens: 90 },
        prompt_cache_hit_tokens: 600,
      })
    ).toBe(90);
  });

  test("toApiUsageFields omits details when nothing was cached", () => {
    const fields = toApiUsageFields({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 });
    expect(fields?.prompt_tokens_details).toBeUndefined();
  });

  test("toApiUsageFields keeps details when cached", () => {
    const fields = toApiUsageFields({
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 90 },
    });
    expect(fields?.prompt_tokens_details).toEqual({ cached_tokens: 90 });
  });
});
