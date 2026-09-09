import { describe, expect, test } from "bun:test";
import { buildChatMessages } from "../src/agent/build-chat-messages.js";
import type { Message } from "../src/session/store.js";

describe("buildChatMessages tool-result image channel (#134)", () => {
  const toolMsgWithImage: Message = {
    role: "tool",
    content: "Image file: shot.png (PNG image).",
    tool_call_id: "call_1",
    apiContent: [
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ],
    timestamp: new Date().toISOString(),
  };

  test("vision-capable: tool apiContent passes through as array content", () => {
    const msgs = buildChatMessages([toolMsgWithImage], "sys", {
      includeToolImages: true,
    });
    const tool = msgs.find((m) => m.role === "tool");
    expect(Array.isArray(tool?.content)).toBe(true);
    const parts = tool?.content as Array<{ type: string }>;
    expect(parts[0]!.type).toBe("image_url");
  });

  test("text-only: image content is stripped back to plain text", () => {
    const msgs = buildChatMessages([toolMsgWithImage], "sys", {
      includeToolImages: false,
    });
    const tool = msgs.find((m) => m.role === "tool");
    expect(typeof tool?.content).toBe("string");
    expect(tool?.content).toBe("Image file: shot.png (PNG image).");
  });

  test("default (no opts) keeps images — vision is the common case", () => {
    const msgs = buildChatMessages([toolMsgWithImage], "sys");
    const tool = msgs.find((m) => m.role === "tool");
    expect(Array.isArray(tool?.content)).toBe(true);
  });

  test("plain tool result without images is untouched", () => {
    const plain: Message = {
      role: "tool",
      content: "42 lines read",
      tool_call_id: "call_2",
      timestamp: new Date().toISOString(),
    };
    const msgs = buildChatMessages([plain], "sys", { includeToolImages: true });
    const tool = msgs.find((m) => m.role === "tool");
    expect(tool?.content).toBe("42 lines read");
  });
});