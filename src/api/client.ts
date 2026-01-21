import OpenAI from "openai";
import { load as loadConfig } from "../util/config";
import * as logger from "../util/logger";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  GLMModel,
  ChatMessage,
  ToolDefinition,
} from "./types";

/**
 * GLM API Client
 * OpenAI-compatible client for Z.AI Coding Plan API
 */

// Z.AI Coding Plan API endpoint (required - no fallback)
const BASE_URL = "https://api.z.ai/api/coding/paas/v4/";

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 32000;

// Retryable HTTP status codes
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class GLMClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "GLMClientError";
  }
}

export class GLMAuthError extends GLMClientError {
  constructor(message: string) {
    super(message, "auth_error", 401);
    this.name = "GLMAuthError";
  }
}

export class GLMRateLimitError extends GLMClientError {
  constructor(message: string, public readonly retryAfter?: number) {
    super(message, "rate_limit", 429);
    this.name = "GLMRateLimitError";
  }
}

interface CompletionOptions {
  model?: GLMModel;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: ChatCompletionRequest["tool_choice"];
  stream?: false;
  signal?: AbortSignal;
}

interface StreamCompletionOptions extends Omit<CompletionOptions, "stream"> {
  stream: true;
}

class GLMClientImpl {
  private client: OpenAI | null = null;
  private apiKey: string | null = null;

  private async getClient(): Promise<OpenAI> {
    if (this.client && this.apiKey) {
      return this.client;
    }

    const config = await loadConfig();
    
    if (!config.apiKey) {
      throw new GLMAuthError("API key not configured. Set GLM_API_KEY environment variable or configure in ~/.config/glm-cli/config.json");
    }

    this.apiKey = config.apiKey;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: BASE_URL,
      maxRetries: 0, // We handle retries ourselves
    });

    return this.client;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateBackoff(attempt: number): number {
    const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * backoff; // 30% jitter
    return Math.min(backoff + jitter, MAX_BACKOFF_MS);
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return RETRYABLE_STATUS_CODES.has(error.status);
    }
    // Network errors are retryable
    if (error instanceof Error && error.message.includes("fetch")) {
      return true;
    }
    return false;
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Check for abort before each attempt
      if (signal?.aborted) {
        throw new GLMClientError("Request aborted", "aborted");
      }

      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors
        if (error instanceof OpenAI.AuthenticationError) {
          throw new GLMAuthError(error.message);
        }

        // Handle rate limiting
        if (error instanceof OpenAI.RateLimitError) {
          const retryAfter = parseInt(
            (error as unknown as { headers?: { "retry-after"?: string } }).headers?.["retry-after"] ?? "60",
            10
          );
          
          if (attempt === MAX_RETRIES - 1) {
            throw new GLMRateLimitError(error.message, retryAfter);
          }

          await logger.warn(`Rate limited, waiting ${retryAfter}s before retry`);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Only retry on retryable errors
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // Last attempt, throw
        if (attempt === MAX_RETRIES - 1) {
          await logger.error(`All ${MAX_RETRIES} retry attempts failed`);
          throw lastError;
        }

        const backoff = this.calculateBackoff(attempt);
        await logger.warn(`Request failed, retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await this.sleep(backoff);
      }
    }

    throw lastError ?? new GLMClientError("Unknown error during retry");
  }

  /**
   * Create a chat completion (non-streaming)
   */
  async complete(options: CompletionOptions): Promise<ChatCompletionResponse> {
    const client = await this.getClient();
    const config = await loadConfig();

    const response = await this.executeWithRetry(
      async () => {
        // Build request with only defined properties (exactOptionalPropertyTypes)
        const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model: options.model ?? config.defaultModel,
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

        const result = await client.chat.completions.create(request);
        return result;
      },
      options.signal
    );

    // Transform to our type
    return {
      id: response.id,
      object: "chat.completion",
      created: response.created,
      model: response.model,
      choices: response.choices.map((choice) => {
        // Map finish_reason, filtering out deprecated "function_call"
        const finishReason = choice.finish_reason === "function_call" 
          ? "tool_calls" as const
          : choice.finish_reason;
        
        return {
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
            // Extract reasoning_content if present (GLM-specific)
            reasoning_content: (choice.message as unknown as { reasoning_content?: string }).reasoning_content,
          },
          finish_reason: finishReason,
        };
      }),
      usage: response.usage ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Create a streaming chat completion
   * Returns an async iterable of chunks
   */
  async *stream(
    options: Omit<StreamCompletionOptions, "stream">
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const client = await this.getClient();
    const config = await loadConfig();

    const stream = await this.executeWithRetry(
      async () => {
        // Build request with only defined properties (exactOptionalPropertyTypes)
        const request: OpenAI.ChatCompletionCreateParamsStreaming = {
          model: options.model ?? config.defaultModel,
          messages: options.messages as OpenAI.ChatCompletionMessageParam[],
          stream: true,
        };

        if (options.temperature !== undefined) request.temperature = options.temperature;
        if (options.top_p !== undefined) request.top_p = options.top_p;
        if (options.max_tokens !== undefined) request.max_tokens = options.max_tokens;
        if (options.stop !== undefined) request.stop = options.stop;
        if (options.tools !== undefined) {
          request.tools = options.tools as OpenAI.ChatCompletionTool[];
          // Z.AI specific: enable tool call streaming output
          // Cast to unknown first then to Record to add non-standard Z.AI parameter
          (request as unknown as Record<string, unknown>)["tool_stream"] = true;
        }
        if (options.tool_choice !== undefined) {
          request.tool_choice = options.tool_choice as OpenAI.ChatCompletionToolChoiceOption;
        }

        return client.chat.completions.create(request);
      },
      options.signal
    );

    for await (const chunk of stream) {
      // Check abort signal during streaming
      if (options.signal?.aborted) {
        stream.controller.abort();
        return;
      }

      // Transform to our chunk type
      yield {
        id: chunk.id,
        object: "chat.completion.chunk",
        created: chunk.created,
        model: chunk.model,
        choices: chunk.choices.map((choice) => {
          // Map finish_reason, filtering out deprecated "function_call"
          const finishReason = choice.finish_reason === "function_call" 
            ? "tool_calls" as const
            : choice.finish_reason;
          
          return {
            index: choice.index,
            delta: {
              role: choice.delta.role as ChatMessage["role"] | undefined,
              content: choice.delta.content,
              // Extract reasoning_content if present (GLM-specific)
              reasoning_content: (choice.delta as unknown as { reasoning_content?: string }).reasoning_content,
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
            finish_reason: finishReason,
          };
        }),
        usage: chunk.usage ? {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        } : null,
      };
    }
  }

  /**
   * Reset the client (useful when API key changes)
   */
  reset(): void {
    this.client = null;
    this.apiKey = null;
  }
}

// Singleton instance
export const GLMClient = new GLMClientImpl();
