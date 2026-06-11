/**
 * Provider-neutral usage parsing helpers.
 */

export interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

export function extractCachedTokens(usage: unknown): number {
  const u = usage as { prompt_tokens_details?: { cached_tokens?: number } } | null | undefined;
  return u?.prompt_tokens_details?.cached_tokens ?? 0;
}

export function parseOpenAIUsage(usage: unknown): ParsedUsage | undefined {
  const u = usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null | undefined;
  if (!u || u.prompt_tokens === undefined) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    cachedTokens: extractCachedTokens(u),
  };
}

/** Map provider usage objects into impulse API usage (includes cached_tokens when present). */
export function toApiUsageFields(usage: unknown):
  | {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      prompt_tokens_details?: { cached_tokens: number };
    }
  | undefined {
  const parsed = parseOpenAIUsage(usage);
  if (!parsed) return undefined;
  return {
    prompt_tokens: parsed.promptTokens,
    completion_tokens: parsed.completionTokens,
    total_tokens: parsed.totalTokens,
    ...(parsed.cachedTokens > 0
      ? { prompt_tokens_details: { cached_tokens: parsed.cachedTokens } }
      : {}),
  };
}
