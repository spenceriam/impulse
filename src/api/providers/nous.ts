/**
 * Nous Research Provider Implementation
 *
 * Provider implementation for Nous Research inference API.
 * Uses OpenAI-compatible endpoint with free models (google/gemma-4-26b-a4b-it:free).
 */

import OpenAI from "openai";
import type { AIProvider, CompletionOptions, StreamCompletionOptions, ProviderConfig } from "../provider";
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk } from "../types";
import { ProviderAuthError, ProviderRateLimitError, ProviderError } from "../provider";

// Nous Research Inference API endpoint
const BASE_URL = "https://inference-api.nousresearch.com/v1";

// Default free model
export const NOUS_DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;

// Retryable HTTP status codes
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class NousProvider implements AIProvider {
  readonly name = "nous";
  readonly requiresAuth = true; // API key required even for free tier

  private client: OpenAI | null = null;
  private apiKey: string | null = null;

  constructor(private config: ProviderConfig) {}

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  private async getClient(): Promise<OpenAI> {
    if (this.client && this.apiKey === this.config.apiKey) {
      return this.client;
    }

    if (!this.config.apiKey) {
      throw new ProviderAuthError("API key not configured for Nous provider");
    }

    this.apiKey = this.config.apiKey;
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl || BASE_URL,
      maxRetries: 0,
    });

    return this.client;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateBackoff(attempt: number): number {
    const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * backoff;
    return Math.min(backoff + jitter, MAX_BACKOFF_MS);
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return RETRYABLE_STATUS_CODES.has(error.status);
    }
    if (error instanceof Error && error.message.includes("fetch")) {
      return true;
    }
    return false;
  }

  private async executeWithRetry<T>(
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

        await this.sleep(retryAfter * 1000);
        return this.executeWithRetry(operation, signal, attempt + 1);
      }

      // Only retry on retryable errors
      if (!this.isRetryableError(error) || attempt === MAX_RETRIES - 1) {
        throw error;
      }

      const backoff = this.calculateBackoff(attempt);
      await this.sleep(backoff);
      return this.executeWithRetry(operation, signal, attempt + 1);
    }
  }

  async complete(options: CompletionOptions): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const model = options.model ?? this.config.defaultModel ?? NOUS_DEFAULT_MODEL;

    const response = await this.executeWithRetry(
      async () => {
        const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model,
          messages: options.messages as OpenAI.ChatCompletionMessageParam[],
          stream: false,
        };

        if (options.temperature !== undefined) request.temperature = options.temperature;
        if (options.top_p !== undefined) request.top_p = options.top_p;
        if (options.max_tokens !== undefined) request.max_tokens = options.max_tokens;
        if (options.stop !== undefined) request.stop = options.stop;
        if (options.tools !== undefined) {
          request.tools = options.tools as OpenAI.ChatCompletionTool[];
        }
        if (options.tool_choice !== undefined) {
          request.tool_choice = options.tool_choice as OpenAI.ChatCompletionToolChoiceOption;
        }

        // NOTE: Nous/Gemma does not support thinking parameter
        // Only include if explicitly requested and model supports it
        if (options.thinking && model.includes("glm")) {
          (request as unknown as Record<string, unknown>)["thinking"] = options.thinking;
        }

        return client.chat.completions.create(request);
      },
      options.signal
    );

    return this.transformResponse(response);
  }

  async *stream(options: StreamCompletionOptions): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const client = await this.getClient();
    const model = options.model ?? this.config.defaultModel ?? NOUS_DEFAULT_MODEL;

    const stream = await this.executeWithRetry(
      async () => {
        const request: OpenAI.ChatCompletionCreateParamsStreaming = {
          model,
          messages: options.messages as OpenAI.ChatCompletionMessageParam[],
          stream: true,
        };

        if (options.temperature !== undefined) request.temperature = options.temperature;
        if (options.top_p !== undefined) request.top_p = options.top_p;
        if (options.max_tokens !== undefined) request.max_tokens = options.max_tokens;
        if (options.stop !== undefined) request.stop = options.stop;
        if (options.tools !== undefined) {
          request.tools = options.tools as OpenAI.ChatCompletionTool[];
        }
        if (options.tool_choice !== undefined) {
          request.tool_choice = options.tool_choice as OpenAI.ChatCompletionToolChoiceOption;
        }

        return client.chat.completions.create(request);
      },
      options.signal
    );

    for await (const chunk of stream) {
      if (options.signal?.aborted) {
        stream.controller.abort();
        return;
      }

      yield this.transformChunk(chunk);
    }
  }

  reset(): void {
    this.client = null;
    this.apiKey = null;
  }

  private transformResponse(response: OpenAI.ChatCompletion): ChatCompletionResponse {
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
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        },
        finish_reason: choice.finish_reason === "function_call" ? "tool_calls" as const : choice.finish_reason,
      })),
      usage: response.usage ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      } : undefined,
    };
  }

  private transformChunk(chunk: OpenAI.ChatCompletionChunk): ChatCompletionChunk {
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
          tool_calls: choice.delta.tool_calls?.map((tc) => ({
            index: tc.index,
            id: tc.id,
            type: tc.type,
            function: tc.function ? {
              name: tc.function.name,
              arguments: tc.function.arguments,
            } : undefined,
          })),
        },
        finish_reason: choice.finish_reason === "function_call" ? "tool_calls" as const : choice.finish_reason,
      })),
      usage: chunk.usage ? {
        prompt_tokens: chunk.usage.prompt_tokens,
        completion_tokens: chunk.usage.completion_tokens,
        total_tokens: chunk.usage.total_tokens,
      } : null,
    };
  }
}
