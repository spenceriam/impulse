import { describe, expect, test } from "bun:test";
import { buildReplaySteps } from "../src/cli/session-replay.js";
import type { Message } from "../src/session/store.js";

describe("buildReplaySteps thinking duration", () => {
  test("includes durationMs from thinking_duration_ms", () => {
    const messages: Message[] = [
      { role: "user", content: "hi", timestamp: "2026-01-01T00:00:00Z" },
      {
        role: "assistant",
        content: "ok",
        reasoning_content: "reasoning here",
        thinking_duration_ms: 4200,
        timestamp: "2026-01-01T00:00:01Z",
      },
    ];

    const steps = buildReplaySteps(messages);
    const thinking = steps.find((s) => s.type === "thinking");
    expect(thinking).toBeDefined();
    if (thinking?.type === "thinking") {
      expect(thinking.durationMs).toBe(4200);
      expect(thinking.text).toBe("reasoning here");
    }
  });
});