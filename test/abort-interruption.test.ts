import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SessionManager } from "../src/session/manager.js";
import {
  INTERRUPTION_MARKER,
  TOOL_CANCELLED_BY_USER,
  answeredToolCallIds,
  finalizeAbortedTurn,
  lastAssistantWithToolCalls,
} from "../src/agent/abort-interruption.js";

const assistantWithToolCalls = {
  role: "assistant" as const,
  content: "Running tools",
  tool_calls: [
    {
      id: "call_done",
      tool: "bash",
      arguments: { command: "echo done" },
      timestamp: new Date().toISOString(),
    },
    {
      id: "call_pending",
      tool: "bash",
      arguments: { command: "echo pending" },
      timestamp: new Date().toISOString(),
    },
  ],
  timestamp: new Date().toISOString(),
};

describe("abort interruption", () => {
  beforeEach(async () => {
    await SessionManager.createNew("abort-interruption-test");
  });

  afterEach(async () => {
    await SessionManager.exitCurrent();
  });

  test("answeredToolCallIds collects tool result ids", () => {
    const ids = answeredToolCallIds([
      { role: "tool", content: "ok", tool_call_id: "a", timestamp: "" },
      { role: "user", content: "hi", timestamp: "" },
    ]);
    expect(ids.has("a")).toBe(true);
    expect(ids.size).toBe(1);
  });

  test("finalizeAbortedTurn persists partial text and interruption marker", async () => {
    await finalizeAbortedTurn({
      iterationText: "Partial reply before cancel",
      iterationAssistantPersisted: false,
    });

    const messages = SessionManager.getCurrentSession()?.messages ?? [];
    expect(messages.some((m) => m.role === "assistant" && m.content.includes("Partial reply"))).toBe(
      true
    );
    expect(messages.some((m) => m.role === "user" && m.content === INTERRUPTION_MARKER)).toBe(true);
  });

  test("finalizeAbortedTurn fills synthetic results for dangling tool_calls", async () => {
    await SessionManager.addMessage(assistantWithToolCalls);
    await SessionManager.addMessage({
      role: "tool",
      content: "done",
      tool_call_id: "call_done",
      timestamp: new Date().toISOString(),
    });

    await finalizeAbortedTurn({
      iterationText: "",
      iterationAssistantPersisted: true,
    });

    const messages = SessionManager.getCurrentSession()?.messages ?? [];
    const pendingResult = messages.find(
      (m) => m.role === "tool" && m.tool_call_id === "call_pending"
    );
    expect(pendingResult?.content).toBe(TOOL_CANCELLED_BY_USER);
    expect(messages.some((m) => m.role === "user" && m.content === INTERRUPTION_MARKER)).toBe(true);
  });

  test("lastAssistantWithToolCalls finds the latest assistant with tools", async () => {
    await SessionManager.addMessage({ role: "user", content: "go", timestamp: "" });
    await SessionManager.addMessage(assistantWithToolCalls);
    const messages = SessionManager.getCurrentSession()?.messages ?? [];
    expect(lastAssistantWithToolCalls(messages)?.tool_calls).toHaveLength(2);
  });
});
