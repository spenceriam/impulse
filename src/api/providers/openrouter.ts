/**
 * OpenRouter Provider Implementation
 *
 * OpenRouter is an OpenAI-compatible API aggregator supporting 100+ models.
 * Endpoint: https://openrouter.ai/api/v1
 * Auth:     OPENROUTER_API_KEY
 * Docs:     https://openrouter.ai/docs
 */

import OpenAI from "openai";
import type {
  AIProvider,
  CompletionOptions,
  StreamCompletionOptions,
  ProviderConfig,
} from "../provider";
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk } from "../types";
import { ProviderAuthError, ProviderRateLimitError, ProviderError } from "../provider";

const BASE_URL = "https://openrouter.ai/api/v1";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter";
  readonly requiresAuth = true;

  private client: OpenAI | null = null;
  private _apiKey: string | null = null;

  constructor(private config: ProviderConfig) {}

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  private async getClient(): Promise<OpenAI> {
    if (this.client && this._apiKey === this.config.apiKey) return this.client;

    if (!this.config.apiKey) {
      throw new ProviderAuthError("OpenRouter API key not configured");
    }

    this._apiKey = this.config.apiKey;
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl || BASE_URL,
      maxRetries: 0,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/spenceriam/impulse",
        "X-Title": "impulse",
      },
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
        throw new ProviderAuthError((error as Error).message);
      }
      if (error instanceof OpenAI.RateLimitError) {
        const retryAfter = parseInt(
          (error as unknown as { headers?: Record<string, string> }).headers?.[
            "retry-after"
          ] ?? "60",
          10
        );
        if (attempt === MAX_RETRIES - 1) {
          throw new ProviderRateLimitError((error as Error).message, retryAfter);
        }
        await this.sleep(retryAfter * 1000);
        return this.withRetry(op, signal, attempt + 1);
      }
      if (!this.isRetryable(error) || attempt === MAX_RETRIES - 1) throw error;
      await this.sleep(this.calculateBackoff(attempt));
      return this.withRetry(op, signal, attempt + 1);
    }
  }

  /** Strip "openrouter/" prefix if present */
  private stripPrefix(model: string | undefined): string {
    if (!model) return "";
    return model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model;
  }

  async complete(options: CompletionOptions): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const model = this.stripPrefix(options.model ?? this.config.defaultModel);

    const response = await this.withRetry(async () => {
      const req: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: options.messages as OpenAI.ChatCompletionMessageParam[],
        stream: false,
      };
      if (options.temperature !== undefined) req.temperature = options.temperature;
      if (options.top_p !== undefined) req.top_p = options.top_p;
      if (options.max_tokens !== undefined) req.max_tokens = options.max_tokens;
      if (options.stop !== undefined) req.stop = options.stop;
      if (options.tools !== undefined)
        req.tools = options.tools as OpenAI.ChatCompletionTool[];
      if (options.tool_choice !== undefined)
        req.tool_choice = options.tool_choice as OpenAI.ChatCompletionToolChoiceOption;
      return client.chat.completions.create(req);
    }, options.signal);

    return this.transformResponse(response);
  }

  async *stream(
    options: StreamCompletionOptions
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const client = await this.getClient();
    const model = this.stripPrefix(options.model ?? this.config.defaultModel);

    const streamResult = await this.withRetry(async () => {
      const req: OpenAI.ChatCompletionCreateParamsStreaming = {
        model,
        messages: options.messages as OpenAI.ChatCompletionMessageParam[],
        stream: true,
        stream_options: { include_usage: true },
      };
      if (options.temperature !== undefined) req.temperature = options.temperature;
      if (options.top_p !== undefined) req.top_p = options.top_p;
      if (options.max_tokens !== undefined) req.max_tokens = options.max_tokens;
      if (options.stop !== undefined) req.stop = options.stop;
      if (options.tools !== undefined)
        req.tools = options.tools as OpenAI.ChatCompletionTool[];
      if (options.tool_choice !== undefined)
        req.tool_choice = options.tool_choice as OpenAI.ChatCompletionToolChoiceOption;
      // OpenRouter supports reasoning effort levels
      if (options.reasoningLevel && options.reasoningLevel !== "off") {
        const effort = options.reasoningLevel === "low" ? "low"
          : options.reasoningLevel === "high" ? "high" : "medium";
        (req as unknown as Record<string, unknown>)["reasoning"] = { effort };
      } else if (options.thinking) {
        (req as unknown as Record<string, unknown>)["reasoning"] = { effort: "high" };
      }
      return client.chat.completions.create(req);
    }, options.signal);

    for await (const chunk of streamResult) {
      if (options.signal?.aborted) {
        streamResult.controller.abort();
        return;
      }
      yield this.transformChunk(chunk);
    }
  }

  reset(): void {
    this.client = null;
    this._apiKey = null;
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
}
