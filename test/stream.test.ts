import { describe, expect, test } from "bun:test";
import { createStreamState, getToolCalls, processChunk } from "../src/api/stream";
import type { ChatCompletionChunk } from "../src/api/types";

function makeChunk(
  delta: ChatCompletionChunk["choices"][number]["delta"],
  finishReason: ChatCompletionChunk["choices"][number]["finish_reason"] = null
): ChatCompletionChunk {
  return {
    id: "chunk-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "glm-4.7",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
    usage: null,
  };
}

describe("processChunk tool call streaming", () => {
  test("emits tool_call_start when id/name are present in first chunk", () => {
    const state = createStreamState();

    const events = processChunk(
      makeChunk({
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: {
              name: "question",
              arguments: "{\"prompt\":\"h",
            },
          },
        ],
      }),
      state
    );

    expect(events).toContainEqual({
      type: "tool_call_start",
      index: 0,
      id: "call_1",
      name: "question",
      arguments: "{\"prompt\":\"h",
    });

    const nextEvents = processChunk(
      makeChunk({
        tool_calls: [
          {
            index: 0,
            function: {
              arguments: "i\"}",
            },
          },
        ],
      }),
      state
    );

    expect(nextEvents).toContainEqual({
      type: "tool_call_delta",
      index: 0,
      arguments: "i\"}",
    });
  });

  test("emits delayed tool_call_start when id/name arrive later and keeps buffered args", () => {
    const state = createStreamState();

    const firstEvents = processChunk(
      makeChunk({
        tool_calls: [
          {
            index: 0,
            function: {
              arguments: "{\"query\":\"hel",
            },
          },
        ],
      }),
      state
    );

    expect(firstEvents).toEqual([]);

    const secondEvents = processChunk(
      makeChunk({
        tool_calls: [
          {
            index: 0,
            id: "call_2",
            type: "function",
            function: {
              name: "webSearchPrime",
              arguments: "lo\"}",
            },
          },
        ],
      }),
      state
    );

    expect(secondEvents).toContainEqual({
      type: "tool_call_start",
      index: 0,
      id: "call_2",
      name: "webSearchPrime",
      arguments: "{\"query\":\"hello\"}",
    });

    expect(secondEvents.some((event) => event.type === "tool_call_delta")).toBe(false);

    const thirdEvents = processChunk(
      makeChunk({
        tool_calls: [
          {
            index: 0,
            function: {
              arguments: ",\"top_k\":3",
            },
          },
        ],
      }),
      state
    );

    expect(thirdEvents).toContainEqual({
      type: "tool_call_delta",
      index: 0,
      arguments: ",\"top_k\":3",
    });

    const toolCalls = getToolCalls(state);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.id).toBe("call_2");
    expect(toolCalls[0]?.function.name).toBe("webSearchPrime");
    expect(toolCalls[0]?.function.arguments).toBe("{\"query\":\"hello\"},\"top_k\":3");
  });
});

