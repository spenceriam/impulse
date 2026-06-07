/**
 * Per-model reliability profiles when multi-turn tool use fails.
 */

import type { Config, ReasoningLevel } from "../util/config.js";

export interface ReliabilityFallback {
  reasoningLevel: ReasoningLevel;
  preserveReasoning: boolean;
}

const DEFAULT_FALLBACK: ReliabilityFallback = {
  reasoningLevel: "off",
  preserveReasoning: false,
};

/** Provider-agnostic fallback when a model misbehaves on tool continuations. */
export function reliabilityFallbackForModel(
  modelId: string,
  config?: Config
): ReliabilityFallback {
  const profile = config?.modelProfiles?.[modelId];
  if (!profile) return DEFAULT_FALLBACK;
  return {
    reasoningLevel: profile.reasoningLevel ?? DEFAULT_FALLBACK.reasoningLevel,
    preserveReasoning: profile.preserveReasoning ?? DEFAULT_FALLBACK.preserveReasoning,
  };
}
