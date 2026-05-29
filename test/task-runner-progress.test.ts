import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../src/api/types.js";
import {
  resolvePreCompleteProgress,
  shouldPublishFinalWrappingUp,
} from "../src/agent/task-runner.js";
import { SUBAGENT_PROGRESS_THINKING } from "../src/cli/subagent-progress-labels.js";

describe("resolvePreCompleteProgress", () => {
  test("publishes thinking when no prior tool results and thinking enabled", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];
    expect(resolvePreCompleteProgress(messages, true)).toEqual({
      type: "thinking",
      content: SUBAGENT_PROGRESS_THINKING,
    });
  });

  test("skips thinking when thinking disabled", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];
    expect(resolvePreCompleteProgress(messages, false)).toBeNull();
  });

  test("after tool results publishes thinking or nothing, not wrapping up", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "", tool_calls: [] },
      { role: "tool", content: "ok", tool_call_id: "t1" },
    ];
    expect(resolvePreCompleteProgress(messages, false)).toBeNull();
    expect(resolvePreCompleteProgress(messages, true)).toEqual({
      type: "thinking",
      content: SUBAGENT_PROGRESS_THINKING,
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
