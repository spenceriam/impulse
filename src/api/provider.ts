/**
 * Provider Abstraction Layer
 * 
 * Allows IMPULSE to use different AI providers (OpenAI, Nous, Z.ai)
 * with a unified interface.
 */

import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, ToolDefinition, ThinkingConfig } from "./types";

// Provider configuration
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
}

// Common completion options across all providers
export interface CompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  stream?: boolean;
  signal?: AbortSignal;
  thinking?: ThinkingConfig;
}

// Stream completion options
export interface StreamCompletionOptions extends CompletionOptions {
  stream: true;
}

// Provider interface
export interface AIProvider {
  /** Provider name (e.g., "z.ai", "openai", "nous") */
  readonly name: string;
  
  /** Whether this provider requires authentication */
  readonly requiresAuth: boolean;
  
  /** Check if the provider is properly configured */
  isConfigured(): boolean;
  
  /** Create a chat completion (non-streaming) */
  complete(options: CompletionOptions): Promise<ChatCompletionResponse>;
  
  /** Create a streaming chat completion */
  stream(options: StreamCompletionOptions): AsyncGenerator<ChatCompletionChunk, void, unknown>;
  
  /** Reset the provider (useful when API key changes) */
  reset(): void;
}

// Error classes
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(message: string) {
    super(message, "auth_error", 401);
    this.name = "ProviderAuthError";
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(message: string, public readonly retryAfter?: number) {
    super(message, "rate_limit", 429);
    this.name = "ProviderRateLimitError";
  }
}
