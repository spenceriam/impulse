/**
 * Ollama Cloud Provider Implementation
 *
 * Supports Ollama Cloud (https://ollama.com) — OpenAI-compatible hosted API.
 * The user supplies a base URL (default: https://ollama.com) and API key.
 *
 * API format: OpenAI-compatible (/v1/chat/completions, /v1/models)
 * Auth:       Bearer token (API key required)
 * Reasoning:  Supported via `think: true` for capable models (deepseek-r1, qwq, etc.)
 *
 * Use testConnection() to validate endpoint + key and discover available models.
 */

import OpenAI from "openai";
import type {
  AIProvider,
  CompletionOptions,
  StreamCompletionOptions,
  ProviderConfig,
} from "../provider";
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk } from "../types";
import { ProviderAuthError, ProviderError } from "../provider";

// Default Ollama Cloud endpoint
export const OLLAMA_DEFAULT_BASE_URL = "https://ollama.com";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Remove the hardcoded allowlist — always pass think:true when thinking is enabled.
 * Ollama ignores the param for models that don't support it.
 * Models known to use it: deepseek-r1, qwq, kimi-k2.6, marco-o1, openthinker, and others.
 * @deprecated use discoverOllamaReasoning() for proper capability detection
 */
export function ollamaSupportsReasoning(_model: string): boolean {
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection test result
// ─────────────────────────────────────────────────────────────────────────────

export interface OllamaConnectionTestResult {
  success: boolean;
  /** Human-readable status message */
  message: string;
  /** Discovered model names, empty if discovery failed */
  models: string[];
  /** Which endpoint path succeeded (for debugging) */
  discoveredVia?: string;
}

/**
 * Test an Ollama Cloud endpoint + API key.
 * Tries multiple known path patterns and returns discovered models.
 *
 * Usage:
 *   const result = await testOllamaConnection("https://ollama.com", "my-api-key");
 *   if (result.success) console.log("Models:", result.models);
 */
export async function testOllamaConnection(
  baseUrl: string,
  apiKey?: string
): Promise<OllamaConnectionTestResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const root = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");

  // Candidate paths to try in order of preference
  const candidates: Array<{ url: string; label: string; parse: (body: unknown) => string[] }> = [
    {
      url: `${root}/v1/models`,
      label: "/v1/models",
      parse: (body) => {
        const b = body as {
          data?: Array<{ id: string; created?: number }>;
          models?: Array<{ name: string; modified_at?: string }>;
        };
        if (b.data && b.data.length > 0) {
          // Sort newest first by created timestamp
          return [...b.data]
            .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
            .map((m) => m.id);
        }
        if (b.models && b.models.length > 0) {
          // Sort newest first by modified_at
          return [...b.models]
            .sort((a, b2) =>
              (b2.modified_at ?? "") > (a.modified_at ?? "") ? 1 : -1
            )
            .map((m) => m.name);
        }
        return [];
      },
    },
    {
      url: `${root}/api/tags`,
      label: "/api/tags",
      parse: (body) => {
        const b = body as { models?: Array<{ name: string; modified_at?: string }> };
        if (!b.models) return [];
        return [...b.models]
          .sort((a, b2) => (b2.modified_at ?? "") > (a.modified_at ?? "") ? 1 : -1)
          .map((m) => m.name);
      },
    },
    {
      url: `${root}/api/models`,
      label: "/api/models",
      parse: (body) => {
        const b = body as { models?: Array<{ name: string }>; data?: Array<{ id: string }> };
        if (b.models && b.models.length > 0) return b.models.map((m) => m.name);
        if (b.data && b.data.length > 0) return b.data.map((m) => m.id);
        return [];
      },
    },
  ];

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url, { headers, signal: AbortSignal.timeout(10_000) });

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          message: `Authentication failed (HTTP ${res.status}). Check your API key.`,
          models: [],
          discoveredVia: candidate.label,
        };
      }

      if (!res.ok) continue; // try next candidate

      const body: unknown = await res.json();
      const models = candidate.parse(body);

      return {
        success: true,
        message:
          models.length > 0
            ? `Connected — ${models.length} model${models.length === 1 ? "" : "s"} available.`
            : "Connected, but no models were returned. Check your account/namespace.",
        models,
        discoveredVia: candidate.label,
      };
    } catch (err) {
      // Network / timeout — keep trying other candidates
      if (err instanceof Error && err.name === "TimeoutError") {
        return {
          success: false,
          message: `Connection timed out. Is "${baseUrl}" reachable?`,
          models: [],
        };
      }
      // continue to next candidate
    }
  }

  return {
    success: false,
    message: `Could not reach "${baseUrl}". Check the endpoint URL and your network connection.`,
    models: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider class
// ─────────────────────────────────────────────────────────────────────────────

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  readonly requiresAuth = true;

  private client: OpenAI | null = null;
  private _clientKey: string | null = null;

  constructor(private config: ProviderConfig) {}

  isConfigured(): boolean {
    return !!(this.config.apiKey || this.config.baseUrl);
  }

  /** Returns the /v1 URL used by the OpenAI SDK */
  private getV1Url(): string {
    const base = (this.config.baseUrl || OLLAMA_DEFAULT_BASE_URL).replace(/\/$/, "");
    return base.endsWith("/v1") ? base : `${base}/v1`;
  }

  private async getClient(): Promise<OpenAI> {
    const v1Url = this.getV1Url();
    const cacheKey = `${this.config.apiKey}::${v1Url}`;
    if (this.client && this._clientKey === cacheKey) return this.client;

    this._clientKey = cacheKey;
    this.client = new OpenAI({
      apiKey: this.config.apiKey || "ollama", // SDK requires non-empty string
      baseURL: v1Url,
      maxRetries: 0,
    });
    return this.client;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateBackoff(attempt: number): number {
    const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    return Math.min(backoff + Math.random() * 0.3 * backoff, MAX_BACKOFF_MS);
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) return RETRYABLE_STATUS_CODES.has(error.status);
    if (error instanceof Error && error.message.includes("fetch")) return true;
    return false;
  }

  private async withRetry<T>(
    op: () => Promise<T>,
    signal?: AbortSignal,
    attempt = 0
  ): Promise<T> {
    try {
      if (signal?.aborted) throw new ProviderError("Request aborted", "aborted");
      return await op();
    } catch (error) {
      if (error instanceof OpenAI.AuthenticationError) {
        throw new ProviderAuthError(
          "Ollama Cloud authentication failed — check your API key."
        );
      }
      if (!this.isRetryable(error) || attempt === MAX_RETRIES - 1) throw error;
      await this.sleep(this.calculateBackoff(attempt));
      return this.withRetry(op, signal, attempt + 1);
    }
  }

  /** Test the configured endpoint + key and return discovered models. */
  async testConnection(): Promise<OllamaConnectionTestResult> {
    const base = (this.config.baseUrl || OLLAMA_DEFAULT_BASE_URL).replace(/\/$/, "");
    return testOllamaConnection(base, this.config.apiKey);
  }

  async complete(options: CompletionOptions): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const model = stripPrefix(options.model ?? this.config.defaultModel);
    if (!model) throw new ProviderError("No model specified for Ollama provider");

    const response = await this.withRetry(async () => {
      const req: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: options.messages as OpenAI.ChatCompletionMessageParam[],
        stream: false,
      };

      applyCommonOptions(req, options);
      if (options.thinking && ollamaSupportsReasoning(model)) {
        (req as unknown as Record<string, unknown>)["think"] = true;
      }

      return client.chat.completions.create(req);
    }, options.signal);

    return transformResponse(response);
  }

  async *stream(
    options: StreamCompletionOptions
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const client = await this.getClient();
    const model = stripPrefix(options.model ?? this.config.defaultModel);
    if (!model) throw new ProviderError("No model specified for Ollama provider");

    const streamResult = await this.withRetry(async () => {
      const req: OpenAI.ChatCompletionCreateParamsStreaming = {
        model,
        messages: options.messages as OpenAI.ChatCompletionMessageParam[],
        stream: true,
      };

      applyCommonOptions(req, options);
      if (options.thinking && ollamaSupportsReasoning(model)) {
        (req as unknown as Record<string, unknown>)["think"] = true;
      }

      return client.chat.completions.create(req);
    }, options.signal);

    for await (const chunk of streamResult) {
      if (options.signal?.aborted) {
        streamResult.controller.abort();
        return;
      }
      yield transformChunk(chunk);
    }
  }

  reset(): void {
    this.client = null;
    this._clientKey = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (module-level, not exported — keeps the class tidy)
// ─────────────────────────────────────────────────────────────────────────────

function stripPrefix(model: string | undefined): string {
  if (!model) return "";
  return model.startsWith("ollama/") ? model.slice("ollama/".length) : model;
}

function applyCommonOptions(
  req: OpenAI.ChatCompletionCreateParams,
  options: CompletionOptions
): void {
  if (options.temperature !== undefined) req.temperature = options.temperature;
  if (options.top_p !== undefined) req.top_p = options.top_p;
  if (options.max_tokens !== undefined) req.max_tokens = options.max_tokens;
  if (options.stop !== undefined) req.stop = options.stop;
  if (options.tools !== undefined) req.tools = options.tools as OpenAI.ChatCompletionTool[];
  if (options.tool_choice !== undefined)
    req.tool_choice = options.tool_choice as OpenAI.ChatCompletionToolChoiceOption;
}

function transformResponse(response: OpenAI.ChatCompletion): ChatCompletionResponse {
  return {
    id: response.id,
    object: "chat.completion",
    created: response.created,
    model: response.model,
    choices: response.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: choice.message.role as ChatMessage["role"],
        content: choice.message.content,
        tool_calls: choice.message.tool_calls?.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        reasoning_content: (
          choice.message as unknown as { reasoning_content?: string }
        ).reasoning_content,
      },
      finish_reason:
        choice.finish_reason === "function_call"
          ? ("tool_calls" as const)
          : choice.finish_reason,
    })),
    usage: response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

function transformChunk(chunk: OpenAI.ChatCompletionChunk): ChatCompletionChunk {
  return {
    id: chunk.id,
    object: "chat.completion.chunk",
    created: chunk.created,
    model: chunk.model,
    choices: chunk.choices.map((choice) => ({
      index: choice.index,
      delta: {
        role: choice.delta.role as ChatMessage["role"] | undefined,
        content: choice.delta.content,
        reasoning_content: (
          choice.delta as unknown as { reasoning_content?: string }
        ).reasoning_content,
        tool_calls: choice.delta.tool_calls?.map((tc) => ({
          index: tc.index,
          id: tc.id,
          type: tc.type,
          function: tc.function
            ? { name: tc.function.name, arguments: tc.function.arguments }
            : undefined,
        })),
      },
      finish_reason:
        choice.finish_reason === "function_call"
          ? ("tool_calls" as const)
          : choice.finish_reason,
    })),
    usage: chunk.usage
      ? {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        }
      : null,
  };
}
