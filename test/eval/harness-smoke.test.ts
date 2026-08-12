import { describe, expect, test } from "bun:test";
import { buildChatMessages } from "../../src/agent/build-chat-messages.js";
import { isImpulseUiMessage } from "../../src/session/status-events.js";
import type { Message } from "../../src/session/store.js";

describe("eval harness smoke", () => {
  test("status events are excluded from API messages", () => {
    const messages: Message[] = [
      {
        role: "system",
        content: "[impulse_ui] Mode changed to ASK",
        timestamp: new Date().toISOString(),
      },
      { role: "user", content: "hello", timestamp: new Date().toISOString() },
    ];
    expect(isImpulseUiMessage(messages[0]!)).toBe(true);
    const api = buildChatMessages(messages, "system");
    expect(api).toHaveLength(2);
    expect(api[0]?.role).toBe("system");
    expect(api[1]?.role).toBe("user");
  });
});
