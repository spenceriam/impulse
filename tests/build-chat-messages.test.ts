import { describe, expect, test } from "bun:test";
import { buildChatMessages } from "../src/agent/build-chat-messages.js";
import type { Message } from "../src/session/store.js";

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
});
