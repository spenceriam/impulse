/**
 * Shared helpers for OpenAI-compatible providers (Groq, Nous, OpenRouter,
 * ZAI, Gemini proxy, Ollama OpenAI compatibility, custom proxies, etc.).
 *
 * Any provider that speaks the OpenAI /v1/models list format can reuse these
 * without duplicating boilerplate.
 */

import type { ModelCapabilities } from "../capabilities";
import { modelSupportsVisionFallback } from "../capabilities";

/**
 * Generic /v1/models discovery for any OpenAI-compatible endpoint.
 *
 * 1. Queries `/v1/models` (or `${baseUrl}/models`) to confirm the model exists.
 * 2. Falls back to name-pattern heuristics for vision / reasoning since custom
 *    endpoints use unpredictable model IDs.
 *
 * Returns `undefined` when the API is unreachable or the model is not listed.
 */
export async function discoverOpenAIModelCapabilities(
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<ModelCapabilities | undefined> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) return undefined;

  const data = (await resp.json()) as {
    data?: Array<{ id: string; [key: string]: unknown }>;
  };

  const m = data.data?.find((d) => d.id === model);
  if (!m) return undefined;

  const lower = model.toLowerCase();

  // Generic heuristic — safe for any OpenAI-compatible endpoint.
  const vision = modelSupportsVisionFallback(model);
  const reasoning =
    lower.includes("reason") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4");

  return { vision, reasoning, source: "provider-api", discoveredAt: Date.now() };
}
