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

export type {
  // Provider abstraction
  AIProvider,
  ProviderConfig,
  CompletionOptions,
  StreamCompletionOptions,
} from "./providers";
export { ProviderError, ProviderAuthError, ProviderRateLimitError } from "./providers";

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
  OllamaProvider,
  OLLAMA_DEFAULT_BASE_URL,
  ollamaSupportsReasoning,
  testOllamaConnection,
} from "./providers";
export type { OllamaConnectionTestResult } from "./providers";

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

// Legacy Z.ai client — prefer using getProviderManager() for new code.
// Prefer using getProviderManager() for new code
export {
  ZAIClient,
  ZAIClientError,
  ZAIAuthError,
  ZAIRateLimitError,
  GLMClient,
  GLMClientError,
  GLMAuthError,
  GLMRateLimitError,
} from "./client";

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
  ZAIModel,
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
  ZAIModel as ZAIModelSchema,
  GLMModel as GLMModelSchema,
  MessageRole as MessageRoleSchema,
  ChatMessage as ChatMessageSchema,
  ChatCompletionRequest as ChatCompletionRequestSchema,
  ChatCompletionResponse as ChatCompletionResponseSchema,
  ChatCompletionChunk as ChatCompletionChunkSchema,
} from "./types";
