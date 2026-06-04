import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../src/api/types.js";
import {
  resolvePreCompleteProgress,
  shouldPublishFinalWrappingUp,
} from "../src/agent/task-runner.js";
import {
  SUBAGENT_PROGRESS_THINKING,
  SUBAGENT_PROGRESS_THINKING_PLACEHOLDER,
} from "../src/cli/subagent-progress-labels.js";

describe("resolvePreCompleteProgress", () => {
  test("publishes thinking when reasoning capable and detail on", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];
    expect(resolvePreCompleteProgress(messages, true, true)).toEqual({
      type: "thinking",
      content: SUBAGENT_PROGRESS_THINKING,
    });
  });

  test("publishes placeholder when reasoning capable but detail off", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];
    expect(resolvePreCompleteProgress(messages, true, false)).toEqual({
      type: "thinking",
      content: SUBAGENT_PROGRESS_THINKING_PLACEHOLDER,
    });
  });

  test("skips when reasoning not capable", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];
    expect(resolvePreCompleteProgress(messages, false, true)).toBeNull();
    expect(resolvePreCompleteProgress(messages, false, false)).toBeNull();
  });

  test("after tool results publishes thinking when capable", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "", tool_calls: [] },
      { role: "tool", content: "ok", tool_call_id: "t1" },
    ];
    expect(resolvePreCompleteProgress(messages, true, false)).toEqual({
      type: "thinking",
      content: SUBAGENT_PROGRESS_THINKING_PLACEHOLDER,
    });
  });
});

describe("shouldPublishFinalWrappingUp", () => {
  test("true when completing after tool results without more tools", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "tool", content: "ok", tool_call_id: "t1" },
    ];
    expect(shouldPublishFinalWrappingUp(messages, false)).toBe(true);
  });

  test("false when model returns more tool calls", () => {
    const messages: ChatMessage[] = [
      { role: "tool", content: "ok", tool_call_id: "t1" },
    ];
    expect(shouldPublishFinalWrappingUp(messages, true)).toBe(false);
  });

  test("false when not after tool results", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "go" }];
    expect(shouldPublishFinalWrappingUp(messages, false)).toBe(false);
  });
});