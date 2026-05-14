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

/** User-facing label for a reasoning level.
 * Binary providers use internal "medium" to mean thinking enabled, but the UI
 * should label that as "thinking" rather than implying a real medium tier. */
export function formatReasoningLevelForDisplay(
  level: ReasoningLevel,
  capability: ReasoningCapability
): string {
  if (capability.style === "binary" && level !== "off") {
    return "thinking";
  }
  return level;
}

// ── Ollama capability discovery via /api/show ────────────────────────────────

interface OllamaShowResponse {
  capabilities?: string[];
  details?: { families?: string[] };
}

const OLLAMA_MAX_OUTPUT_TOKEN_KEYS = new Set([
  "max_output_tokens",
  "max_completion_tokens",
]);

export function extractExplicitMaxOutputTokens(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractExplicitMaxOutputTokens(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (OLLAMA_MAX_OUTPUT_TOKEN_KEYS.has(key) && typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  for (const value of Object.values(payload as Record<string, unknown>)) {
    const found = extractExplicitMaxOutputTokens(value);
    if (found !== undefined) return found;
  }

  return undefined;
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

  // Heuristic fallback: stay conservative unless the model name clearly signals
  // a dedicated reasoning family. Do NOT broadly assume all DeepSeek/Kimi models
  // support thinking — hosted/cloud variants may not expose it.
  const lower = modelName.toLowerCase();
  const likelyReasoning =
    lower.includes("thinking")    ||
    lower.includes("deepseek") ||
    /(^|[^a-z0-9])r1([^a-z0-9]|$)/.test(lower) ||
    lower.includes("qwq")         ||
    lower.includes("kimi-k2")     ||
    lower.includes("marco-o1")    ||
    lower.includes("openthinker");

  return {
    supported: likelyReasoning,
    style:     "binary",
    levels:    likelyReasoning ? BINARY_LEVELS : NO_LEVELS,
  };
}

/**
 * Best-effort discovery of explicit max output tokens for an Ollama-hosted model.
 * Returns undefined when the provider does not expose the value.
 */
export async function discoverOllamaMaxOutputTokens(
  baseUrl: string,
  modelName: string,
  apiKey?: string
): Promise<number | undefined> {
  const root = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const tryExtract = async (
    input: string | URL,
    init?: RequestInit,
    matcher?: (payload: unknown) => unknown
  ): Promise<number | undefined> => {
    try {
      const res = await fetch(input, { ...init, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return undefined;
      const payload = await res.json();
      const matched = matcher ? matcher(payload) : payload;
      return extractExplicitMaxOutputTokens(matched);
    } catch {
      return undefined;
    }
  };

  const fromModelList = await tryExtract(`${root}/v1/models`, { headers }, (payload) => {
    const body = payload as {
      data?: Array<Record<string, unknown>>;
      models?: Array<Record<string, unknown>>;
    };
    const entries = body.data ?? body.models ?? [];
    return entries.find((entry) => entry["id"] === modelName || entry["name"] === modelName) ?? payload;
  });
  if (fromModelList !== undefined) return fromModelList;

  const fromApiModels = await tryExtract(`${root}/api/models`, { headers }, (payload) => {
    const body = payload as {
      data?: Array<Record<string, unknown>>;
      models?: Array<Record<string, unknown>>;
    };
    const entries = body.data ?? body.models ?? [];
    return entries.find((entry) => entry["id"] === modelName || entry["name"] === modelName) ?? payload;
  });
  if (fromApiModels !== undefined) return fromApiModels;

  return tryExtract(`${root}/api/show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelName }),
  });
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
