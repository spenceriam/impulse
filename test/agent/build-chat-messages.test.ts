import { describe, expect, test } from "bun:test";
import {
  buildChatMessages,
  COMPACT_SUMMARY_PREFIX,
} from "../../src/agent/build-chat-messages.js";
import type { Message } from "../../src/session/store.js";

describe("buildChatMessages", () => {
  test("forwards reasoning_content on assistant messages", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "hello",
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: "hi",
        reasoning_content: "internal plan: check tests first",
        timestamp: new Date().toISOString(),
      },
    ];

    const chat = buildChatMessages(messages, "system");
    expect(chat).toHaveLength(3);
    expect(chat[0]?.role).toBe("system");
    expect(chat[2]?.role).toBe("assistant");
    expect(chat[2]?.reasoning_content).toBe("internal plan: check tests first");
  });

  test("omits empty reasoning_content", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "ok",
        reasoning_content: "   ",
        timestamp: new Date().toISOString(),
      },
    ];

    const chat = buildChatMessages(messages, "sys");
    const assistant = chat.find((m) => m.role === "assistant");
    expect(assistant?.reasoning_content).toBeUndefined();
  });

  test("forwards tool result messages with tool_call_id", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            tool: "file_read",
            arguments: { path: "a.ts" },
            timestamp: new Date().toISOString(),
          },
        ],
        timestamp: new Date().toISOString(),
      },
      {
        role: "tool",
        content: "file contents",
        tool_call_id: "call_1",
        timestamp: new Date().toISOString(),
      },
    ];

    const chat = buildChatMessages(messages, "sys");
    const toolMsg = chat.find((m) => m.role === "tool");
    expect(toolMsg).toEqual({
      role: "tool",
      content: "file contents",
      tool_call_id: "call_1",
    });
  });

  test("merges compact summary system messages into the system prompt", () => {
    const messages: Message[] = [
      {
        role: "system",
        content: `${COMPACT_SUMMARY_PREFIX}\n\nUser wanted API client tests.`,
        timestamp: new Date().toISOString(),
      },
      {
        role: "user",
        content: "continue",
        timestamp: new Date().toISOString(),
      },
    ];

    const chat = buildChatMessages(messages, "You are impulse.");
    expect(chat).toHaveLength(2);
    expect(chat[0]?.role).toBe("system");
    expect(chat[0]?.content).toContain("You are impulse.");
    expect(chat[0]?.content).toContain(COMPACT_SUMMARY_PREFIX);
    expect(chat[0]?.content).toContain("API client tests");
  });
});
