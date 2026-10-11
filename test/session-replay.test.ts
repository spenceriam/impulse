import { describe, expect, test } from "bun:test";
import { buildReplaySteps } from "../src/cli/session-replay.js";
import type { Message } from "../src/session/store.js";

const baseMsg = {
  role: "assistant",
  timestamp: "2026-10-11T00:00:00.000Z",
} as const;

describe("session replay", () => {
  test("quiet replay drops tool rows and emits persisted Recap", () => {
    const messages: Message[] = [
      { role: "user", content: "fix the bug", timestamp: "2026-10-11T00:00:00.000Z" },
      {
        ...baseMsg,
        content: "Fixed it.",
        recap: "Fixed the wrap width so recaps stop truncating",
        tool_calls: [
          {
            id: "tc1",
            tool: "file_edit",
            arguments: { filePath: "a.ts" },
            timestamp: "2026-10-11T00:00:01.000Z",
          },
        ],
      },
      {
        role: "tool",
        content: "Edited a.ts",
        tool_call_id: "tc1",
        timestamp: "2026-10-11T00:00:02.000Z",
      },
    ];

    const quiet = buildReplaySteps(messages, { quiet: true });
    expect(quiet.some((s) => s.type === "tool")).toBe(false);
    expect(quiet.some((s) => s.type === "recap")).toBe(true);

    const verbose = buildReplaySteps(messages);
    expect(verbose.some((s) => s.type === "tool")).toBe(true);
    expect(verbose.some((s) => s.type === "recap")).toBe(false);
  });

  test("legacy think envelopes stripped from old-session content", () => {
    const open = "\u003Cthink\u003E";
    const close = "\u003C/think\u003E";
    const messages: Message[] = [
      { role: "user", content: "hi", timestamp: "2026-10-11T00:00:00.000Z" },
      {
        ...baseMsg,
        content: `Let me check. ${open}I need to verify the config first${close} All set — the config is clean.`,
      },
    ];
    const steps = buildReplaySteps(messages, { quiet: true });
    const text = steps.find((s) => s.type === "assistantText");
    expect(text && "text" in text ? text.text : "").toBe(
      "Let me check.  All set — the config is clean."
    );
  });

  test("unclosed legacy think tail dropped (crashed session)", () => {
    const open = "\u003Cthink\u003E";
    const messages: Message[] = [
      { role: "user", content: "hi", timestamp: "2026-10-11T00:00:00.000Z" },
      {
        ...baseMsg,
        content: `Starting work. ${open}half-way through a thou`,
      },
    ];
    const steps = buildReplaySteps(messages);
    const text = steps.find((s) => s.type === "assistantText");
    expect(text && "text" in text ? text.text : "").toBe("Starting work.");
  });
});