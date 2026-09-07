/**
 * Shared helpers for OpenAI-compatible providers (Groq, Nous, OpenRouter,
 * ZAI, Gemini proxy, Ollama OpenAI compatibility, custom proxies, etc.).
 *
 * Any provider that speaks the OpenAI /v1/models list format can reuse these
 * without duplicating boilerplate.
 */

import OpenAI from "openai";
import { ProviderAuthError, ProviderError, ProviderRateLimitError } from "../provider";
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

// --- Shared OpenAI-SDK retry scaffolding (zai, openai, nous, groq, gemini) ---

export const MAX_RETRIES = 3;
export const INITIAL_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 16000;
export const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function calculateBackoff(attempt: number): number {
  const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * backoff;
  return Math.min(backoff + jitter, MAX_BACKOFF_MS);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }
  if (error instanceof Error && error.message.includes("fetch")) {
    return true;
  }
  return false;
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  attempt: number = 0
): Promise<T> {
  try {
    if (signal?.aborted) {
      throw new ProviderError("Request aborted", "aborted");
    }
    return await operation();
  } catch (error) {
    // Don't retry auth errors
    if (error instanceof OpenAI.AuthenticationError) {
      throw new ProviderAuthError(error.message);
    }

    // Handle rate limiting
    if (error instanceof OpenAI.RateLimitError) {
      const retryAfter = parseInt(
        (error as unknown as { headers?: { "retry-after"?: string } }).headers?.["retry-after"] ?? "60",
        10
      );

      if (attempt === MAX_RETRIES - 1) {
        throw new ProviderRateLimitError(error.message, retryAfter);
      }

      await sleep(retryAfter * 1000);
      return executeWithRetry(operation, signal, attempt + 1);
    }

    // Only retry on retryable errors
    if (!isRetryableError(error) || attempt === MAX_RETRIES - 1) {
      throw error;
    }

    const backoff = calculateBackoff(attempt);
    await sleep(backoff);
    return executeWithRetry(operation, signal, attempt + 1);
  }
}
