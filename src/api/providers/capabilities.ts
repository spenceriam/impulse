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
  // Custom provider sentinels (used during setup)
  "__custom_openai__":     "effort",
  "__custom_anthropic__":  "budget",
};

export const EFFORT_LEVELS: ReasoningLevel[] = ["off", "low", "medium", "high"];
export const BINARY_LEVELS: ReasoningLevel[] = ["off", "medium"]; // medium = "on"
export const NO_LEVELS:     ReasoningLevel[] = ["off"];

/**
 * Baseline when a provider gives no capability data (#210). We know thinking
 * can be toggled on most OpenAI-compatible models, so offer on/off rather than
 * silently claiming the model cannot reason.
 */
export const UNKNOWN_REASONING: ReasoningCapability = {
  supported: true,
  style: "binary",
  levels: BINARY_LEVELS,
};

export function getLevelsForStyle(style: ReasoningStyle): ReasoningLevel[] {
  switch (style) {
    case "effort": return EFFORT_LEVELS;
    case "binary": return BINARY_LEVELS;
    case "budget": return EFFORT_LEVELS; // budget maps low->2k, medium->8k, high->16k
    default:       return NO_LEVELS;
  }
}

/**
 * Extra levels a provider advertises beyond the built-in baseline (#147).
 * OpenRouter lists them per model as `supported_parameters`/`reasoning_efforts`
 * (e.g. "xhigh", "max"); unknown tiers are accepted rather than dropped.
 */
const REASONING_TIER_RE = /^(x?high|max|minimal|none|low|medium|high|off)$/i;

export function advertisedReasoningLevels(raw: unknown): ReasoningLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: ReasoningLevel[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.toLowerCase();
    if (REASONING_TIER_RE.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Merge discovered levels into a baseline, keeping "off" first. */
export function mergeReasoningLevels(
  baseline: ReasoningLevel[],
  discovered: ReasoningLevel[]
): ReasoningLevel[] {
  const merged = [...baseline];
  for (const level of discovered) {
    if (!merged.includes(level)) merged.push(level);
  }
  return merged.includes("off") ? merged : ["off", ...merged];
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
      if (Array.isArray(data.capabilities) && data.capabilities.length > 0) {
        const caps = data.capabilities;
        const hasThinking = caps.includes("thinking");
        return {
          supported: hasThinking,
          style:     hasThinking ? "binary" : "none",
          levels:    hasThinking ? BINARY_LEVELS : NO_LEVELS,
        };
      }
      // Empty/absent capability list is UNKNOWN, not "no reasoning" (#210):
      // report the baseline and never claim the model cannot think.
      return UNKNOWN_REASONING;
    }
  } catch {
    // /api/show unreachable is also unknown (#210) — the name heuristic
    // below only refines what we can guess, never denies capability.
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

  if (!likelyReasoning) {
    // Unknown, not "no reasoning": the model may still think, we just have no
    // evidence. Offering on/off is honest; offering only "off" is a guess (#210).
    return UNKNOWN_REASONING;
  }
  return {
    supported: true,
    style:     "binary",
    levels:    BINARY_LEVELS,
  };
}

/**
 * Query Ollama /api/show for vision capability.
 * Returns `undefined` when the endpoint is unavailable or gives no
 * capability data — callers fall through to catalog/probe layers rather
 * than treating a name-pattern guess as authoritative.
 */
export async function discoverOllamaVision(
  baseUrl: string,
  modelName: string,
  apiKey?: string
): Promise<boolean | undefined> {
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
      if (Array.isArray(data.capabilities)) {
        return data.capabilities.includes("vision");
      }
    }
  } catch {
    // fall through
  }

  return undefined;
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
export function levelToEffort(level: ReasoningLevel): string | undefined {
  if (level === "off") return undefined;
  if (level === "low") return "low";
  if (level === "high") return "high";
  if (level === "medium") return "medium";
  // Provider-advertised tiers (xhigh, max, …) pass through unchanged (#147/#210).
  return level;
}

/** Map to Anthropic budget_tokens */
export function levelToBudgetTokens(level: ReasoningLevel): number | undefined {
  if (level === "off") return undefined;
  const map: Record<string, number | undefined> = {
    low:    2048,
    medium: 8192,
    high:   16384,
    // Tiers beyond the baseline scale from high rather than collapsing to it.
    xhigh:  24576,
    max:    32768,
  };
  return map[level] ?? 8192;
}

/** Probe a custom provider endpoint to detect reasoning support.
 *  Sends a minimal request with reasoning enabled and checks for 4xx rejection. */
export async function probeReasoningSupport(
  providerType: "openai-compatible" | "anthropic-compatible",
  baseUrl: string,
  apiKey: string,
  model: string,
  timeout: number = 5000
): Promise<ReasoningCapability> {
  const root = baseUrl.replace(/\/$/, "");
  const isAnthropic = providerType === "anthropic-compatible";

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let body: string;
    let url: string;

    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      url = `${root}/messages`;
      body = JSON.stringify({
        model,
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
        thinking: { type: "enabled", budget_tokens: 1024 },
        stream: false,
      });
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
      url = `${root}/chat/completions`;
      body = JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
        reasoning_effort: "low",
        stream: false,
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });

    if (res.ok) {
      return {
        supported: true,
        style: isAnthropic ? "budget" : "effort",
        levels: isAnthropic ? EFFORT_LEVELS : EFFORT_LEVELS,
      };
    }
    return { supported: false, style: "none", levels: NO_LEVELS };
  } catch {
    return { supported: false, style: "none", levels: NO_LEVELS };
  }
}



// ── Per-model reasoning levels discovered from providers (#147) ─────────────

const discoveredReasoningLevels = new Map<string, ReasoningLevel[]>();

function reasoningModelKey(model: string): string {
  return model.toLowerCase();
}

/** Remember the level list a provider advertised for a model. */
export function setReasoningLevelsForModel(
  model: string,
  levels: ReasoningLevel[]
): void {
  if (!model || levels.length === 0) return;
  discoveredReasoningLevels.set(reasoningModelKey(model), levels);
}

/** Discovered levels for a model, if any provider has advertised them. */
export function getReasoningLevelsForModel(
  model: string
): ReasoningLevel[] | undefined {
  return discoveredReasoningLevels.get(reasoningModelKey(model));
}

/** Test hook: forget discovered levels. */
export function clearReasoningLevels(): void {
  discoveredReasoningLevels.clear();
}
