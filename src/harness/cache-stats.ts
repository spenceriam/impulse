/**
 * Per-session cache accounting (#194).
 *
 * Cache regressions are otherwise invisible: a prompt-assembly change that
 * reorders tool definitions, a timestamp in the system prompt, or a compaction
 * that rewrites the prefix drops the hit rate to zero and the only symptom is a
 * bigger bill. These helpers turn the usage numbers impulse already parses
 * into a hit rate, a savings estimate, and a cold-cache signal.
 */

export interface CacheStats {
  /** Prompt tokens served from cache (billed at a discount). */
  cacheReadTokens: number;
  /** Tokens written into the cache this session. */
  cacheWriteTokens: number;
  /** Total prompt tokens, cached + uncached. */
  promptTokens: number;
  /** cacheRead / promptTokens, 0 when nothing was sent. */
  hitRate: number;
  /** Estimated tokens saved: cache reads instead of full-price input. */
  savedTokens: number;
}

/** Providers bill cached input at a fraction of the input price. */
const DEFAULT_CACHE_DISCOUNT = 0.5;

export function computeCacheStats(opts: {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  promptTokens?: number;
  /** Fraction of the input price a cache read costs (default 0.5). */
  discount?: number;
}): CacheStats {
  const read = Math.max(0, opts.cacheReadTokens ?? 0);
  const write = Math.max(0, opts.cacheWriteTokens ?? 0);
  const prompt = Math.max(0, opts.promptTokens ?? 0);
  const discount = opts.discount ?? DEFAULT_CACHE_DISCOUNT;
  return {
    cacheReadTokens: read,
    cacheWriteTokens: write,
    promptTokens: prompt,
    hitRate: prompt > 0 ? read / prompt : 0,
    savedTokens: Math.round(read * (1 - discount)),
  };
}

/** Minimum prompt size before a cold cache is worth mentioning. */
export const COLD_CACHE_MIN_PROMPT_TOKENS = 4000;
/** Consecutive cold turns before warning. */
export const COLD_CACHE_TURNS = 3;

/**
 * Track consecutive turns with a large prompt but no cache reads, so the
 * renderer can warn once instead of nagging every turn.
 */
export class ColdCacheTracker {
  private cold = 0;
  private warned = false;

  /** Returns true exactly once per cold streak that recovers and drops again. */
  observe(stats: CacheStats): boolean {
    if (stats.promptTokens < COLD_CACHE_MIN_PROMPT_TOKENS) {
      this.cold = 0;
      return false;
    }
    if (stats.cacheReadTokens > 0) {
      this.cold = 0;
      this.warned = false;
      return false;
    }
    this.cold += 1;
    if (this.cold >= COLD_CACHE_TURNS && !this.warned) {
      this.warned = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.cold = 0;
    this.warned = false;
  }
}
