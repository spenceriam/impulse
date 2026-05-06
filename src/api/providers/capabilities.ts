/**
 * Provider reasoning capability discovery.
 *
 * Each provider has a "reasoning style":
 *   binary  — think: true/false  (Ollama, ZAI, Qwen)
 *   effort  — reasoning_effort: "low"|"medium"|"high"  (OpenAI o-series, OpenRouter)
 *   budget  — budget_tokens: number  (Anthropic, Gemini)
 *   none    — no reasoning support (Groq base models, etc.)
 *
 * For Ollama specifically, we query /api/show to discover whether
 * a specific model supports thinking, since the model list doesn't
 * include capability flags.
 */

import type { ReasoningLevel } from "../../util/config";

export type ReasoningStyle = "binary" | "effort" | "budget" | "none";

export interface ReasoningCapability {
  supported: boolean;
  style: ReasoningStyle;
  /** Ordered levels the provider+model supports, always starting with "off" */
  levels: ReasoningLevel[];
}

// ── Per-provider default styles ─────────────────────────────────────────────

/** Default reasoning style per provider name */
export const PROVIDER_REASONING_STYLE: Record<string, ReasoningStyle> = {
  "ollama":     "binary",
  "z.ai":       "binary",
  "openai":     "effort",   // o-series only; GPT-4 etc. = none but safe to pass
  "openrouter": "effort",
  "anthropic":  "budget",
  "groq":       "none",     // Groq models don't support thinking yet
  "gemini":     "budget",
  "nous":       "none",
};

export const EFFORT_LEVELS: ReasoningLevel[] = ["off", "low", "medium", "high"];
export const BINARY_LEVELS: ReasoningLevel[] = ["off", "medium"]; // medium = "on"
export const NO_LEVELS:     ReasoningLevel[] = ["off"];

export function getLevelsForStyle(style: ReasoningStyle): ReasoningLevel[] {
  switch (style) {
    case "effort": return EFFORT_LEVELS;
    case "binary": return BINARY_LEVELS;
    case "budget": return EFFORT_LEVELS; // budget maps low→2k, medium→8k, high→16k
    default:       return NO_LEVELS;
  }
}

/** Cycle to the next reasoning level for this capability */
export function cycleReasoningLevel(
  current: ReasoningLevel,
  capability: ReasoningCapability
): ReasoningLevel {
  const levels = capability.supported ? capability.levels : NO_LEVELS;
  const idx = levels.indexOf(current);
  return levels[(idx + 1) % levels.length] ?? "off";
}

// ── Ollama capability discovery via /api/show ────────────────────────────────

interface OllamaShowResponse {
  capabilities?: string[];
  details?: { families?: string[] };
}

/**
 * Query Ollama's /api/show to find out whether a model supports thinking.
 * Falls back gracefully if the endpoint is unavailable.
 */
export async function discoverOllamaReasoning(
  baseUrl: string,
  modelName: string,
  apiKey?: string
): Promise<ReasoningCapability> {
  const root = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(`${root}/api/show`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: modelName }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = (await res.json()) as OllamaShowResponse;
      const caps = data.capabilities ?? [];
      const hasThinking = caps.includes("thinking");
      return {
        supported: hasThinking,
        style:     "binary",
        levels:    hasThinking ? BINARY_LEVELS : NO_LEVELS,
      };
    }
  } catch {
    // /api/show not available (Ollama Cloud might not expose it) —
    // fall back to a heuristic on the model name
  }

  // Heuristic fallback: model names that are known reasoning models
  const lower = modelName.toLowerCase();
  const likelyReasoning =
    lower.includes("thinking") ||
    lower.includes("r1")       ||
    lower.includes("qwq")      ||
    lower.includes("k2")       || // kimi-k2.x family
    lower.includes("kimi")     ||
    lower.includes("deepseek") ||
    lower.includes("marco-o1") ||
    lower.includes("openthinker");

  return {
    supported: likelyReasoning,
    style:     "binary",
    levels:    likelyReasoning ? BINARY_LEVELS : NO_LEVELS,
  };
}

// ── Map ReasoningLevel to provider parameters ────────────────────────────────

/** Map to OpenAI-style reasoning_effort string */
export function levelToEffort(level: ReasoningLevel): "low" | "medium" | "high" | undefined {
  if (level === "off") return undefined;
  if (level === "low") return "low";
  if (level === "high") return "high";
  return "medium"; // default for "medium" and binary "on"
}

/** Map to Anthropic budget_tokens */
export function levelToBudgetTokens(level: ReasoningLevel): number | undefined {
  const map: Record<ReasoningLevel, number | undefined> = {
    off:    undefined,
    low:    2048,
    medium: 8192,
    high:   16384,
  };
  return map[level];
}
