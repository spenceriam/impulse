/**
 * Compaction trigger resolution (#182).
 *
 * Hermes's pattern: provider-reported token counts when available, heuristic
 * fallback otherwise; plus per-model threshold overrides (substring match,
 * longest key wins) so small local models can compact earlier than cloud ones.
 */

export const COMPACT_WARNING_THRESHOLD = 0.50;  // Orange % in context bar (50–59%)
export const COMPACT_TRIGGER_THRESHOLD = 0.60;  // Auto-compact triggers at 60%

/** Min NEW messages beyond the recent tail before auto-compact may fire again
 *  (#179 thrash guard — prevents compact-per-message and summary self-feed). */
export const MIN_NEW_MESSAGES_AFTER_COMPACT = 5;

/**
 * Auto-compact eligibility (#179): compact only when enough NEW messages have
 * accumulated past the recent tail to be worth summarizing. When the tail
 * alone exceeds the threshold, compaction cannot help — the hard-limit hint
 * (Use /compact or /new) is the graceful path, not a summarizer cycle.
 */
export function autoCompactEligible(
  messageCount: number,
  keepRecentCount: number,
  minNew: number = MIN_NEW_MESSAGES_AFTER_COMPACT
): boolean {
  return messageCount > keepRecentCount + minNew;
}

/**
 * Per-model compaction threshold (#182): the user-configured default, with a
 * per-model override resolved by longest-substring match on the model id
 * (Hermes's config shape: { "glm-5.2": 0.40, "claude-sonnet": 0.35 }).
 */
export function resolveCompactionThreshold(opts: {
  model?: string | undefined;
  userThreshold?: number | undefined;
  modelThresholds?: Record<string, number> | undefined;
}): number {
  const fallback = opts.userThreshold ?? COMPACT_TRIGGER_THRESHOLD;
  const overrides = opts.modelThresholds;
  if (!opts.model || !overrides) return fallback;
  let best: string | null = null;
  for (const key of Object.keys(overrides)) {
    if (opts.model.includes(key) && (best === null || key.length > best.length)) {
      best = key;
    }
  }
  return best !== null ? overrides[best]! : fallback;
}

/**
 * Provider-anchored compact usage (#182): prefer the provider-reported
 * prompt-token count captured at the end of the last turn; fall back to the
 * chars/token heuristic estimate when it's unavailable (fresh session,
 * no completed turn yet, provider didn't report usage).
 */
export function resolveCompactUsage(opts: {
  providerTokens?: number | undefined;
  estimatedTokens: number;
  contextWindow: number;
}): { usage: number; source: "provider" | "estimate" } {
  const pt = opts.providerTokens;
  if (pt !== undefined && pt > 0 && opts.contextWindow > 0) {
    return { usage: pt / opts.contextWindow, source: "provider" };
  }
  return { usage: opts.estimatedTokens / opts.contextWindow, source: "estimate" };
}
