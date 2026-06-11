import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance } from "../src/session/store.js";

const assistantWithToolCalls = {
  role: "assistant" as const,
  content: "",
  tool_calls: [
    {
      id: "call_race_1",
      tool: "bash",
      arguments: { command: "echo hello" },
      timestamp: new Date().toISOString(),
    },
  ],
  timestamp: new Date().toISOString(),
};

describe("session clobbering race", () => {
  beforeEach(async () => {
    SessionStoreInstance.setSaveDelay(60_000);
    await SessionManager.createNew("session-race-test");
  });

  afterEach(async () => {
    SessionStoreInstance.setSaveDelay(1000);
    await SessionManager.exitCurrent();
  });

  test("update({ todos }) preserves debounced messages in memory", async () => {
    await SessionManager.addMessage(assistantWithToolCalls);

    await SessionManager.update({
      todos: [
        {
          id: "1",
          content: "Phase 0",
          status: "in_progress",
          priority: "high",
        },
      ],
    });

    const session = SessionManager.getCurrentSession();
    expect(session?.messages).toHaveLength(1);
    expect(session?.messages[0]?.role).toBe("assistant");
    expect(session?.messages[0]?.tool_calls?.[0]?.tool).toBe("bash");
    expect(session?.todos).toHaveLength(1);
  });

  test("update({ todos }) preserves debounced messages on disk after flush", async () => {
    await SessionManager.addMessage(assistantWithToolCalls);

    await SessionManager.update({
      todos: [
        {
          id: "1",
          content: "Phase 0",
          status: "in_progress",
          priority: "high",
        },
      ],
    });

    await SessionManager.flushCurrent();

    const session = SessionManager.getCurrentSession();
    const onDisk = await SessionStoreInstance.read(session!.id);
    expect(onDisk.messages).toHaveLength(1);
    expect(onDisk.messages[0]?.tool_calls?.[0]?.id).toBe("call_race_1");
    expect(onDisk.todos).toHaveLength(1);
  });

  test("setHeaderTitle preserves debounced messages in memory and on disk", async () => {
    await SessionManager.addMessage(assistantWithToolCalls);

    await SessionManager.setHeaderTitle("Round 2 smoke test");

    const session = SessionManager.getCurrentSession();
    expect(session?.messages).toHaveLength(1);
    expect(session?.headerTitle).toBe("Round 2 smoke test");

    await SessionManager.flushCurrent();

    const onDisk = await SessionStoreInstance.read(session!.id);
    expect(onDisk.messages).toHaveLength(1);
    expect(onDisk.headerTitle).toBe("Round 2 smoke test");
  });
});
