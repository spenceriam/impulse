import { describe, expect, test } from "bun:test";
import { buildReplaySteps } from "../src/cli/session-replay.js";
import type { Message } from "../src/session/store.js";

describe("buildReplaySteps injected messages", () => {
  test("tagged injected user message becomes injected step", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "[User steering — this overrides prior instructions] skip tests",
        injected: true,
        timestamp: new Date().toISOString(),
      },
    ];
    const steps = buildReplaySteps(messages);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      type: "injected",
      text: "[User steering — this overrides prior instructions] skip tests",
    });
  });

  test("normal user message stays user step", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "run the cap smoke test",
        timestamp: new Date().toISOString(),
      },
    ];
    const steps = buildReplaySteps(messages);
    expect(steps[0]).toEqual({ type: "user", text: "run the cap smoke test" });
  });

  test("legacy language-retry note falls back to injected", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "Please respond in English.",
        timestamp: new Date().toISOString(),
      },
    ];
    const steps = buildReplaySteps(messages);
    expect(steps[0]?.type).toBe("injected");
  });

  test("user message starting with [System] stays user when not a known nudge", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "[System] design doc for the auth module",
        timestamp: new Date().toISOString(),
      },
    ];
    const steps = buildReplaySteps(messages);
    expect(steps[0]?.type).toBe("user");
  });

  test("legacy untagged steer prefix falls back to injected", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "[User steering — old session] do X",
        timestamp: new Date().toISOString(),
      },
    ];
    const steps = buildReplaySteps(messages);
    expect(steps[0]?.type).toBe("injected");
  });
});
