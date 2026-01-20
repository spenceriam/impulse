// GLM API Client
export { GLMClient, GLMClientError, GLMAuthError, GLMRateLimitError } from "./client";

// Streaming
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

// Types
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
