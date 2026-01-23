import type { ChatCompletionChunk, ChatMessage, ToolCall } from "./types";

/**
 * Streaming Handler
 * Processes SSE chunks and aggregates content/reasoning
 */

// Accumulated state from streaming chunks
export interface StreamState {
  // Accumulated content
  content: string;
  // Accumulated reasoning/thinking content (GLM-specific)
  reasoningContent: string;
  // Final role (usually 'assistant')
  role: ChatMessage["role"] | null;
  // Accumulated tool calls (indexed by tool call index)
  toolCalls: Map<number, PartialToolCall>;
  // Finish reason from the stream
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  // Token usage (only available at end of stream)
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // Z.AI specific: cached tokens from preserved thinking
    cachedTokens: number;
  } | null;
}

// Partial tool call being accumulated
interface PartialToolCall {
  id: string;
  functionName: string;
  functionArguments: string;
}

// Events emitted during streaming
export type StreamEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call_start"; index: number; id: string; name: string; arguments: string }
  | { type: "tool_call_delta"; index: number; arguments: string }
  | { type: "done"; state: StreamState };

// Callback for stream events
export type StreamEventHandler = (event: StreamEvent) => void;

/**
 * Create a new stream state
 */
export function createStreamState(): StreamState {
  return {
    content: "",
    reasoningContent: "",
    role: null,
    toolCalls: new Map(),
    finishReason: null,
    usage: null,
  };
}

/**
 * Process a single chunk and update state
 * Returns events generated from this chunk
 */
export function processChunk(
  chunk: ChatCompletionChunk,
  state: StreamState
): StreamEvent[] {
  const events: StreamEvent[] = [];

  for (const choice of chunk.choices) {
    const delta = choice.delta;

    // Update role if present
    if (delta.role) {
      state.role = delta.role;
    }

    // Process content delta
    if (delta.content) {
      state.content += delta.content;
      events.push({ type: "content", delta: delta.content });
    }

    // Process reasoning content (GLM thinking mode)
    if (delta.reasoning_content) {
      state.reasoningContent += delta.reasoning_content;
      events.push({ type: "reasoning", delta: delta.reasoning_content });
    }

    // Process tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = state.toolCalls.get(tc.index);

        if (!existing) {
          // New tool call
          const partial: PartialToolCall = {
            id: tc.id ?? "",
            functionName: tc.function?.name ?? "",
            functionArguments: tc.function?.arguments ?? "",
          };
          state.toolCalls.set(tc.index, partial);

          if (tc.id && tc.function?.name) {
            events.push({
              type: "tool_call_start",
              index: tc.index,
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments ?? "",
            });
          }
        } else {
          // Accumulate to existing tool call
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.functionName = tc.function.name;
          if (tc.function?.arguments) {
            existing.functionArguments += tc.function.arguments;
            events.push({
              type: "tool_call_delta",
              index: tc.index,
              arguments: tc.function.arguments,
            });
          }
        }
      }
    }

    // Update finish reason
    if (choice.finish_reason) {
      state.finishReason = choice.finish_reason;
    }
  }

  // Update usage if present (usually only on final chunk)
  if (chunk.usage) {
    state.usage = {
      promptTokens: chunk.usage.prompt_tokens,
      completionTokens: chunk.usage.completion_tokens,
      totalTokens: chunk.usage.total_tokens,
      // Z.AI specific: cached tokens from preserved thinking
      cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  return events;
}

/**
 * Convert accumulated tool calls to final format
 */
export function getToolCalls(state: StreamState): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // Sort by index to maintain order
  const sortedEntries = [...state.toolCalls.entries()].sort((a, b) => a[0] - b[0]);
  
  for (const [_, partial] of sortedEntries) {
    if (partial.id && partial.functionName) {
      calls.push({
        id: partial.id,
        type: "function",
        function: {
          name: partial.functionName,
          arguments: partial.functionArguments,
        },
      });
    }
  }
  
  return calls;
}

/**
 * Convert stream state to a complete ChatMessage
 */
export function stateToMessage(state: StreamState): ChatMessage {
  const toolCalls = getToolCalls(state);
  
  return {
    role: state.role ?? "assistant",
    content: state.content || null,
    reasoning_content: state.reasoningContent || undefined,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * High-level stream processor that handles async iteration
 */
export class StreamProcessor {
  private state: StreamState;
  private eventHandler: StreamEventHandler | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    this.state = createStreamState();
  }

  /**
   * Set event handler for real-time updates
   */
  onEvent(handler: StreamEventHandler): this {
    this.eventHandler = handler;
    return this;
  }

  /**
   * Get the current accumulated state
   */
  getState(): StreamState {
    return this.state;
  }

  /**
   * Get abort signal for cancellation
   */
  getAbortSignal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }

  /**
   * Abort the stream
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Process an async iterable of chunks
   */
  async process(
    chunks: AsyncIterable<ChatCompletionChunk>
  ): Promise<StreamState> {
    for await (const chunk of chunks) {
      // Check for abort
      if (this.abortController?.signal.aborted) {
        break;
      }

      const events = processChunk(chunk, this.state);
      
      // Emit events
      if (this.eventHandler) {
        for (const event of events) {
          this.eventHandler(event);
        }
      }
    }

    // Emit done event
    if (this.eventHandler) {
      this.eventHandler({ type: "done", state: this.state });
    }

    return this.state;
  }

  /**
   * Reset for reuse
   */
  reset(): void {
    this.state = createStreamState();
    this.abortController = null;
  }
}

/**
 * Convenience function to process a stream and return the final message
 */
export async function processStream(
  chunks: AsyncIterable<ChatCompletionChunk>,
  onEvent?: StreamEventHandler
): Promise<ChatMessage> {
  const processor = new StreamProcessor();
  if (onEvent) {
    processor.onEvent(onEvent);
  }
  const state = await processor.process(chunks);
  return stateToMessage(state);
}
