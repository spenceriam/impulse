import { describe, expect, test } from "bun:test";
import { messageDisplayText } from "../src/session/injected-message.js";
import type { Message } from "../src/session/store.js";

describe("messageDisplayText", () => {
  test("strips carriage returns for session replay", () => {
    const msg: Message = {
      role: "user",
      content: "line one\rline two\r\nline three",
      timestamp: new Date().toISOString(),
    };
    const text = messageDisplayText(msg);
    expect(text).not.toContain("\r");
    expect(text).toContain("line one\nline two\nline three");
  });
});
