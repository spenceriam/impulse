import { describe, expect, test } from "bun:test";
import { buildReplaySteps } from "../src/cli/session-replay.js";
import {
  formatImpulseSettle,
  formatImpulseUiStatus,
} from "../src/session/status-events.js";
import type { Message } from "../src/session/store.js";

const ts = "2026-01-01T00:00:00Z";

describe("buildReplaySteps settle lines (#176)", () => {
  test("persisted settle line becomes a settle step", () => {
    const messages: Message[] = [
      { role: "user", content: "do it", timestamp: ts },
      {
        role: "assistant",
        content: "done",
        content_blocks: [{ id: "b1", type: "text", text: "done" }],
        timestamp: ts,
      },
      { role: "system", content: formatImpulseSettle("Worked for 31s using 1 tool"), timestamp: ts },
    ];

    const steps = buildReplaySteps(messages);
    const settle = steps.find((s) => s.type === "settle");
    expect(settle).toBeDefined();
    if (settle?.type === "settle") {
      expect(settle.text).toBe("Worked for 31s using 1 tool");
    }
    // Order: user → assistant text → settle (matches the live turn)
    expect(steps.map((s) => s.type)).toEqual(["user", "assistantText", "settle"]);
  });

  test("runtime status notices stay status steps (not prose)", () => {
    const messages: Message[] = [
      {
        role: "system",
        content: formatImpulseUiStatus("Reliability profile: reasoning off"),
        timestamp: ts,
      },
    ];
    const steps = buildReplaySteps(messages);
    expect(steps).toEqual([
      { type: "status", text: "Reliability profile: reasoning off" },
    ]);
  });

  test("compaction summary becomes a compacted step at its position", () => {
    const messages: Message[] = [
      {
        role: "system",
        content: "Previous conversation summary:\n\nGoal was installing the CLI; verified working.",
        timestamp: ts,
      },
      { role: "user", content: "continue", timestamp: ts },
    ];
    const steps = buildReplaySteps(messages);
    expect(steps.map((s) => s.type)).toEqual(["compacted", "user"]);
    if (steps[0]?.type === "compacted") {
      expect(steps[0].text).toContain("Goal was installing the CLI");
    }
  });
});

describe("buildReplaySteps thinking merge (#176)", () => {
  test("adjacent thinking blocks collapse into one step with summed duration", () => {
    const messages: Message[] = [
      { role: "user", content: "hi", timestamp: ts },
      {
        role: "assistant",
        content: "",
        content_blocks: [
          { id: "t1", type: "thinking", thinking: "first thought", durationMs: 400 },
          { id: "t2", type: "thinking", thinking: "second thought", durationMs: 200 },
          { id: "x1", type: "text", text: "answer" },
        ],
        timestamp: ts,
      },
    ];

    const steps = buildReplaySteps(messages);
    const thinking = steps.filter((s) => s.type === "thinking");
    expect(thinking.length).toBe(1);
    if (thinking[0]?.type === "thinking") {
      expect(thinking[0].durationMs).toBe(600);
      expect(thinking[0].text).toContain("first thought");
      expect(thinking[0].text).toContain("second thought");
    }
  });

  test("thinking does not merge across assistant messages", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        content_blocks: [{ id: "t1", type: "thinking", thinking: "msg one", durationMs: 100 }],
        timestamp: ts,
      },
      {
        role: "assistant",
        content: "",
        content_blocks: [{ id: "t2", type: "thinking", thinking: "msg two", durationMs: 250 }],
        timestamp: ts,
      },
    ];

    const steps = buildReplaySteps(messages);
    const thinking = steps.filter((s) => s.type === "thinking");
    expect(thinking.length).toBe(2);
    if (thinking[0]?.type === "thinking" && thinking[1]?.type === "thinking") {
      expect(thinking[0].text).toBe("msg one");
      expect(thinking[1].text).toBe("msg two");
    }
  });
});
