// ============================================================
// Unified AI Provider API
// ============================================================
// The ProviderManager is the primary interface for making
// chat completions. It routes model strings to the correct
// provider and handles auth/retries uniformly.
//
// Example:
//   const { getProviderManager } = await import("../api");
//   const mgr = await getProviderManager();
//   const provider = mgr.getProvider("openai/gpt-4o");
//   for await (const chunk of provider.stream({ messages })) { ... }
// ============================================================

export {
  // Provider abstraction
  AIProvider,
  ProviderConfig,
  CompletionOptions,
  StreamCompletionOptions,
  ProviderError,
  ProviderAuthError,
  ProviderRateLimitError,
} from "./providers";

export {
  // Individual providers (for direct use if needed)
  ZAIProvider,
  OpenAIProvider,
  NousProvider,
  NOUS_DEFAULT_MODEL,
  OpenRouterProvider,
  GroqProvider,
  GROQ_MODELS,
  GeminiProvider,
} from "./providers";

export {
  // Provider manager
  ProviderManager,
  getProviderManager,
  resetProviderManager,
  parseModelString,
  PROVIDER_PREFIXES,
  type ModelInfo,
  type ProviderKey,
} from "./manager";

// Legacy GLMClient — kept for backward compatibility during migration
// Prefer using getProviderManager() for new code
export { GLMClient, GLMClientError, GLMAuthError, GLMRateLimitError } from "./client";

// Streaming utilities
export {
  StreamProcessor,
  processStream,
  processChunk,
  createStreamState,
  stateToMessage,
  getToolCalls,
} from "./stream";

export type {
  StreamState,
  StreamEvent,
  StreamEventHandler,
} from "./stream";

// Core types
export type {
  GLMModel,
  MessageRole,
  ChatMessage,
  MessageContent,
  ToolCall,
  ToolDefinition,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionChoice,
  StreamChoice,
  StreamDelta,
  Usage,
  APIError,
} from "./types";

// Schemas (for validation)
export {
  GLMModel as GLMModelSchema,
  MessageRole as MessageRoleSchema,
  ChatMessage as ChatMessageSchema,
  ChatCompletionRequest as ChatCompletionRequestSchema,
  ChatCompletionResponse as ChatCompletionResponseSchema,
  ChatCompletionChunk as ChatCompletionChunkSchema,
} from "./types";
