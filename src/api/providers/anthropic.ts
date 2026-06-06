/**
 * Anthropic Provider Implementation
 *
 * Provider implementation for Anthropic Messages API (Claude models).
 * Uses raw fetch — no SDK dependency.
 *
 * Key differences from OpenAI:
 *   - Auth: x-api-key header (not Bearer)
 *   - System prompt: top-level parameter (not a message role)
 *   - Tools: { name, description, input_schema } (not { type: "function", function: {...} })
 *   - Tool calls: content blocks (tool_use / tool_result) instead of tool_calls array
 *   - max_tokens is REQUIRED
 *   - Streaming: SSE with different event types
 *   - Reasoning: thinking { type, budget_tokens }
 */

import type { AIProvider, CompletionOptions, StreamCompletionOptions, ProviderConfig } from "../provider";
import { ProviderAuthError, ProviderRateLimitError, ProviderError } from "../provider";
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, ToolDefinition } from "../types";
import type { ModelCapabilities } from "../capabilities";
import { levelToBudgetTokens } from "./capabilities.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;

// ── Anthropic-specific wire types ───────────────────────────────────────────

interface AnthropicTool {
  name: string;
  description: string | undefined;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string | Array<{ type: "text"; text: string }>;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: "auto" } | { type: "any" } | { type: "tool"; name: string };
  thinking?: { type: "enabled"; budget_tokens: number } | { type: "disabled" };
  stop_sequences?: string[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// ── Converter helpers ───────────────────────────────────────────────────────

function convertTools(tools: ToolDefinition[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

function extractMediaType(dataUri: string): string {
  const m = dataUri.match(/^data:([^;]+);base64,/);
  return m ? m[1]! : "image/png";
}

function extractBase64(dataUri: string): string {
  const idx = dataUri.indexOf(",");
  return idx === -1 ? dataUri : dataUri.slice(idx + 1);
}

function convertMessages(messages: ChatMessage[]): {
  system: string | undefined;
  anthropicMessages: AnthropicMessage[];
} {
  let system: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Accumulate system messages
      const content = typeof msg.content === "string" ? msg.content : "";
      system = system ? `${system}\n\n${content}` : content;
      continue;
    }

    if (msg.role === "user") {
      const blocks: AnthropicContentBlock[] = [];
      if (typeof msg.content === "string") {
        if (msg.content) blocks.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && part.text) {
            blocks.push({ type: "text", text: part.text });
          } else if (part.type === "image_url" && part.image_url?.url) {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: extractMediaType(part.image_url.url),
                data: extractBase64(part.image_url.url),
              },
            });
          }
        }
      }
      if (blocks.length > 0) {
        anthropicMessages.push({ role: "user", content: blocks });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];

      // Text content
      if (msg.content && typeof msg.content === "string" && msg.content.length > 0) {
        blocks.push({ type: "text", text: msg.content });
      }

      // Tool calls -> tool_use blocks
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }

      // Only add if there are content blocks (Anthropic requires at least one)
      if (blocks.length > 0) {
        anthropicMessages.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    if (msg.role === "tool") {
      // Tool result -> tool_result block (must follow an assistant message with tool_use)
      const content = typeof msg.content === "string" ? msg.content : "";
      const target = anthropicMessages[anthropicMessages.length - 1];
      if (target && target.role === "user") {
        // Anthropic expects tool_result as a user message
        target.content.push({
          type: "tool_result",
          tool_use_id: msg.tool_call_id ?? "",
          content,
        });
      } else {
        // Create a new user message with the tool result
        anthropicMessages.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: msg.tool_call_id ?? "",
            content,
          }],
        });
      }
    }
  }

  return { system: system || undefined, anthropicMessages };
}

function convertToolChoice(
  toolChoice: CompletionOptions["tool_choice"]
): AnthropicRequest["tool_choice"] | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "required") return { type: "any" };
  if (toolChoice === "none") return undefined;
  if (typeof toolChoice === "object" && toolChoice.type === "function") {
    return { type: "tool", name: toolChoice.function.name };
  }
  return undefined;
}

// ── Response transformation ─────────────────────────────────────────────────

function transformResponse(response: AnthropicResponse, model: string): ChatCompletionResponse {
  const textBlocks = response.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>;
  const toolUseBlocks = response.content.filter((b) => b.type === "tool_use") as Array<{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;
  const thinkingBlocks = response.content.filter((b) => b.type === "thinking") as Array<{ type: "thinking"; thinking: string; signature: string }>;

  const textContent = textBlocks.map((b) => b.text).join("");
  const reasoningContent = thinkingBlocks.map((b) => b.thinking).join("");

  const finishReason =
    response.stop_reason === "tool_use" ? "tool_calls" as const :
    response.stop_reason === "max_tokens" ? "length" as const :
    response.stop_reason === "stop_sequence" ? "stop" as const :
    response.stop_reason === "end_turn" ? "stop" as const :
    null;

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolUseBlocks.length > 0
          ? toolUseBlocks.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.input),
              },
            }))
          : undefined,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

// ── Provider class ──────────────────────────────────────────────────────────

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly requiresAuth = true;

  constructor(private config: ProviderConfig) {}

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }

  private buildRequest(options: CompletionOptions): AnthropicRequest {
    const { system, anthropicMessages } = convertMessages(options.messages);

    const request: AnthropicRequest = {
      model: options.model ?? this.config.defaultModel,
      max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
      messages: anthropicMessages,
      stream: options.stream ?? false,
    };

    if (system) request.system = system;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.top_p !== undefined) request.top_p = options.top_p;
    if (options.stop) {
      request.stop_sequences = Array.isArray(options.stop) ? options.stop : [options.stop];
    }

    const tools = convertTools(options.tools);
    if (tools) {
      request.tools = tools;
      request.tool_choice = convertToolChoice(options.tool_choice) ?? { type: "auto" };
    }

    // Reasoning / thinking
    const rl = options.reasoningLevel;
    if (rl && rl !== "off") {
      const budgetTokens = levelToBudgetTokens(rl) ?? 8192;
      request.thinking = { type: "enabled", budget_tokens: budgetTokens };
    }

    return request;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private calculateBackoff(attempt: number): number {
    const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * backoff;
    return Math.min(backoff + jitter, MAX_BACKOFF_MS);
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
      if (error instanceof ProviderError) throw error;

      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError("Request aborted", "aborted");
      }

      // Check for auth errors (401)
      if (error instanceof Error && error.message.includes("401")) {
        throw new ProviderAuthError("Authentication failed. Check your API key.");
      }

      if (error instanceof Error && error.message.includes("429")) {
        const retryAfter = 60;
        if (attempt === MAX_RETRIES - 1) {
          throw new ProviderRateLimitError("Rate limited", retryAfter);
        }
        await this.sleep(retryAfter * 1000);
        return this.executeWithRetry(operation, signal, attempt + 1);
      }

      if (attempt >= MAX_RETRIES - 1) {
        throw error instanceof Error ? error : new ProviderError(String(error));
      }

      const backoff = this.calculateBackoff(attempt);
      await this.sleep(backoff);
      return this.executeWithRetry(operation, signal, attempt + 1);
    }
  }

  async complete(options: CompletionOptions): Promise<ChatCompletionResponse> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const request = this.buildRequest({ ...options, stream: false });

    const response = await this.executeWithRetry(async () => {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(request),
        signal: options.signal ?? null,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 401) throw new Error(`401: ${text}`);
        if (res.status === 429) throw new Error(`429: ${text}`);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      return res.json() as Promise<AnthropicResponse>;
    }, options.signal);

    return transformResponse(response, request.model);
  }

  async *stream(options: StreamCompletionOptions): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const request = this.buildRequest({ ...options, stream: true });

    const res = await this.executeWithRetry(async () => {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(request),
        signal: options.signal ?? null,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 401) throw new Error(`401: ${text}`);
        if (res.status === 429) throw new Error(`429: ${text}`);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      return res;
    }, options.signal);

    if (!res.body) {
      throw new ProviderError("No response body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track state for chunk reconstruction
    let messageId = "";
    let model = request.model;
    let created = Math.floor(Date.now() / 1000);
    let inputTokens = 0;
    let outputTokens = 0;
    let currentText = "";
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let reasoningText = "";
    let finishReason: ChatCompletionChunk["choices"][0]["finish_reason"] = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data) as Record<string, unknown>;

            switch (event["type"]) {
              case "message_start": {
                const msg = event["message"] as Record<string, unknown> | undefined;
                if (msg) {
                  messageId = (msg["id"] as string) ?? messageId;
                  model = (msg["model"] as string) ?? model;
                  const usage = msg["usage"] as Record<string, number> | undefined;
                  if (usage) {
                    inputTokens = usage["input_tokens"] ?? inputTokens;
                  }
                }
                break;
              }

              case "content_block_start": {
                const block = event["content_block"] as Record<string, unknown> | undefined;
                if (!block) continue;
                const idx = event["index"] as number | undefined;
                if (idx === undefined) continue;

                if (block["type"] === "tool_use") {
                  toolCalls.set(idx, {
                    id: (block["id"] as string) ?? "",
                    name: (block["name"] as string) ?? "",
                    arguments: "",
                  });
                }
                break;
              }

              case "content_block_delta": {
                const delta = event["delta"] as Record<string, unknown> | undefined;
                if (!delta) continue;
                const idx = event["index"] as number | undefined;

                if (delta["type"] === "text_delta") {
                  const text = (delta["text"] as string) ?? "";
                  currentText += text;
                } else if (delta["type"] === "input_json_delta" && idx !== undefined) {
                  const partial = (delta["partial_json"] as string) ?? "";
                  const tc = toolCalls.get(idx);
                  if (tc) {
                    tc.arguments += partial;
                  }
                } else if (delta["type"] === "thinking_delta") {
                  const thinking = (delta["thinking"] as string) ?? "";
                  reasoningText += thinking;
                } else if (delta["type"] === "signature_delta") {
                  // Signature is internal — we ignore it
                }
                break;
              }

              case "content_block_stop": {
                // Content block complete — no action needed
                break;
              }

              case "message_delta": {
                const delta = event["delta"] as Record<string, unknown> | undefined;
                if (delta) {
                  const sr = delta["stop_reason"] as string | undefined;
                  if (sr === "tool_use") finishReason = "tool_calls";
                  else if (sr === "max_tokens") finishReason = "length";
                  else if (sr === "end_turn" || sr === "stop_sequence") finishReason = "stop";
                }
                const usage = event["usage"] as Record<string, number> | undefined;
                if (usage) {
                  outputTokens = usage["output_tokens"] ?? outputTokens;
                }
                break;
              }

              case "message_stop": {
                // Final event
                break;
              }
            }
          } catch {
            // Skip unparseable SSE data
          }

          // Yield incremental chunks
          if (currentText || reasoningText) {
            const delta: ChatCompletionChunk["choices"][0]["delta"] = {};

            if (currentText) {
              delta.content = currentText;
              currentText = "";
            }

            if (reasoningText) {
              delta.reasoning_content = reasoningText;
              reasoningText = "";
            }

            yield {
              id: messageId || "msg_unknown",
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta,
                finish_reason: null,
              }],
              usage: null,
            };
          }
        }
      }

      // Final chunk with tool calls and finish reason
      const finalDelta: ChatCompletionChunk["choices"][0]["delta"] = {};

      if (toolCalls.size > 0) {
        finalDelta.tool_calls = [...toolCalls.entries()].map(([index, tc]) => ({
          index,
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      const finalChunk: ChatCompletionChunk = {
        id: messageId || "msg_unknown",
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: finalDelta,
          finish_reason: finishReason,
        }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      };

      yield finalChunk;
    } finally {
      reader.releaseLock();
    }
  }

  reset(): void {
    // No-op for stateless fetch-based provider
  }

  async discoverModelCapabilities(model: string): Promise<ModelCapabilities | undefined> {
    if (!this.config.apiKey) return undefined;
    const base = this.config.baseUrl || DEFAULT_BASE_URL;

    const resp = await fetch(`${base.replace(/\/$/, "")}/models`, {
      headers: this.buildHeaders(),
    });
    if (!resp.ok) return undefined;

    const data = (await resp.json()) as {
      data?: Array<{ id: string; [key: string]: unknown }>;
    };
    const m = data.data?.find((d) => d.id === model);
    if (!m) return undefined;

    const lower = model.toLowerCase();
    const vision =
      lower.startsWith("claude-3") ||
      lower.startsWith("claude-3.5") ||
      lower.startsWith("claude-3.7") ||
      lower.startsWith("claude-4") ||
      false;
    const reasoning = lower.includes("thinking") || lower.includes("reasoning");

    return { vision, reasoning, source: "heuristic", discoveredAt: Date.now() };
  }
}
