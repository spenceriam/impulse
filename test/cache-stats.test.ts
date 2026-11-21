import { describe, expect, test } from "bun:test";
import {
  COLD_CACHE_MIN_PROMPT_TOKENS,
  COLD_CACHE_TURNS,
  ColdCacheTracker,
  computeCacheStats,
} from "../src/harness/cache-stats.js";

describe("computeCacheStats", () => {
  test("hit rate is cache reads over prompt tokens", () => {
    const stats = computeCacheStats({
      cacheReadTokens: 8000,
      cacheWriteTokens: 500,
      promptTokens: 10000,
    });
    expect(stats.hitRate).toBe(0.8);
    expect(stats.savedTokens).toBe(4000);
  });

  test("zero prompt tokens never divide by zero", () => {
    const stats = computeCacheStats({ cacheReadTokens: 0, promptTokens: 0 });
    expect(stats.hitRate).toBe(0);
    expect(stats.savedTokens).toBe(0);
  });

  test("negative or missing inputs clamp to zero", () => {
    const stats = computeCacheStats({ cacheReadTokens: -5, promptTokens: undefined });
    expect(stats.cacheReadTokens).toBe(0);
    expect(stats.promptTokens).toBe(0);
  });
});

describe("ColdCacheTracker", () => {
  const cold = { promptTokens: COLD_CACHE_MIN_PROMPT_TOKENS + 1000, cacheReadTokens: 0 };

  test("warns once after consecutive cold turns, not every turn", () => {
    const tracker = new ColdCacheTracker();
    const results: boolean[] = [];
    for (let i = 0; i < COLD_CACHE_TURNS + 2; i++) {
      results.push(tracker.observe(computeCacheStats(cold)));
    }
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a cache hit resets the streak", () => {
    const tracker = new ColdCacheTracker();
    tracker.observe(computeCacheStats(cold));
    tracker.observe(computeCacheStats(cold));
    tracker.observe(
      computeCacheStats({ promptTokens: 10000, cacheReadTokens: 9000 })
    );
    // Streak restarted — one cold turn is not enough to warn again.
    expect(tracker.observe(computeCacheStats(cold))).toBe(false);
  });

  test("small prompts never trigger the warning", () => {
    const tracker = new ColdCacheTracker();
    const small = computeCacheStats({ promptTokens: 500, cacheReadTokens: 0 });
    for (let i = 0; i < COLD_CACHE_TURNS + 3; i++) {
      expect(tracker.observe(small)).toBe(false);
    }
  });
});
