import z from "zod";

/**
 * GLM API Types
 * OpenAI-compatible types for Z.AI Coding Plan API
 */

// Supported GLM models
export const GLMModel = z.enum([
  "glm-4.7",        // Flagship - complex coding, reasoning (default)
  "glm-4.7-flash",  // Fast flagship variant
  "glm-4.6",        // Previous gen flagship
  "glm-4.6v",       // Vision - image understanding
  "glm-4.5",        // Efficient general model
  "glm-4.5-air",    // Lightweight, fast
  "glm-4.5-flash",  // Ultra-fast
  "glm-4.5v",       // Vision - quick image tasks
]);

export type GLMModel = z.infer<typeof GLMModel>;

// Chat message roles
export const MessageRole = z.enum(["system", "user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRole>;

// Tool call structure
export const ToolCall = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export type ToolCall = z.infer<typeof ToolCall>;

// Chat message content can be string or array (for vision models)
export const TextContent = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ImageUrlContent = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

export const MessageContent = z.union([
  z.string(),
  z.array(z.union([TextContent, ImageUrlContent])),
]);

export type MessageContent = z.infer<typeof MessageContent>;

// Base chat message
export const ChatMessage = z.object({
  role: MessageRole,
  content: MessageContent.nullable(),
  name: z.string().optional(),
  tool_calls: z.array(ToolCall).optional(),
  tool_call_id: z.string().optional(),
  // GLM-specific: reasoning content from thinking mode
  reasoning_content: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessage>;

// Tool definition for function calling
export const ToolDefinition = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

export type ToolDefinition = z.infer<typeof ToolDefinition>;

// Chat completion request
export const ChatCompletionRequest = z.object({
  model: GLMModel,
  messages: z.array(ChatMessage),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  tools: z.array(ToolDefinition).optional(),
  tool_choice: z.union([
    z.literal("auto"),
    z.literal("none"),
    z.literal("required"),
    z.object({
      type: z.literal("function"),
      function: z.object({ name: z.string() }),
    }),
  ]).optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequest>;

// Prompt tokens details (Z.AI specific - cache information)
export const PromptTokensDetails = z.object({
  cached_tokens: z.number().optional(),
});

export type PromptTokensDetails = z.infer<typeof PromptTokensDetails>;

// Usage statistics
export const Usage = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  // Z.AI specific: cache token details
  prompt_tokens_details: PromptTokensDetails.optional(),
});

export type Usage = z.infer<typeof Usage>;

// Thinking configuration (Z.AI specific)
export const ThinkingConfig = z.object({
  type: z.enum(["enabled", "disabled"]),
  // clear_thinking: false = Preserved Thinking (keep reasoning across turns)
  // Enabled by default on Coding Plan endpoint
  clear_thinking: z.boolean().optional(),
});

export type ThinkingConfig = z.infer<typeof ThinkingConfig>;

// Chat completion choice
export const ChatCompletionChoice = z.object({
  index: z.number(),
  message: ChatMessage,
  finish_reason: z.enum(["stop", "length", "tool_calls", "content_filter"]).nullable(),
});

export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoice>;

// Chat completion response
export const ChatCompletionResponse = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(ChatCompletionChoice),
  usage: Usage.optional(),
});

export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponse>;

// Streaming delta
export const StreamDelta = z.object({
  role: MessageRole.optional(),
  content: z.string().nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({
    index: z.number(),
    id: z.string().optional(),
    type: z.literal("function").optional(),
    function: z.object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    }).optional(),
  })).optional(),
});

export type StreamDelta = z.infer<typeof StreamDelta>;

// Streaming choice
export const StreamChoice = z.object({
  index: z.number(),
  delta: StreamDelta,
  finish_reason: z.enum(["stop", "length", "tool_calls", "content_filter"]).nullable(),
});

export type StreamChoice = z.infer<typeof StreamChoice>;

// Streaming chunk
export const ChatCompletionChunk = z.object({
  id: z.string(),
  object: z.literal("chat.completion.chunk"),
  created: z.number(),
  model: z.string(),
  choices: z.array(StreamChoice),
  usage: Usage.optional().nullable(),
});

export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunk>;

// API error response
export const APIError = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});

export type APIError = z.infer<typeof APIError>;
