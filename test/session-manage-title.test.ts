import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Bus, HeaderEvents } from "../src/bus/index.js";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance, type Message } from "../src/session/store.js";
import { manageSessionTitle } from "../src/session/manage-session-title.js";

const created: string[] = [];

function turn(content: string): Message[] {
  return [
    { role: "user", content, timestamp: new Date().toISOString() },
    {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      tool_calls: [
        {
          id: `call_${Math.random().toString(36).slice(2)}`,
          type: "function" as const,
          function: { name: "file_read", arguments: "{}" },
        },
      ],
    },
    { role: "tool", content: "ok", tool_call_id: "call_x", timestamp: new Date().toISOString() },
  ];
}

function turns(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) messages.push(...turn(`task ${i}`));
  return messages;
}

/** Stub title call — keeps the network out of these tests. */
function stubTitle(title: string | null) {
  const calls: Array<{ messages: Message[]; model: string }> = [];
  const fn = async (messages: Message[], model: string) => {
    calls.push({ messages, model });
    return title;
  };
  return { fn, calls };
}

async function cleanup(): Promise<void> {
  SessionStoreInstance.setSaveDelay(1000);
  await SessionManager.exitCurrent();
  for (const id of created.splice(0)) {
    try {
      await SessionStoreInstance.delete(id);
    } catch {
      /* already gone */
    }
  }
}

describe("manageSessionTitle", () => {
  beforeEach(async () => {
    SessionStoreInstance.setSaveDelay(60_000);
    await SessionManager.createNew(`zz-manage-title-${Date.now()}-${Math.random()}`);
    created.push(SessionManager.getCurrentSession()!.id);
  });

  afterEach(cleanup);

  test("does not call the model before the purpose is firm", async () => {
    const stub = stubTitle("Heartbeat reconnect loop");

    const result = await manageSessionTitle({
      messages: turn("just one message"),
      model: "deepseek/deepseek-flash",
      generate: stub.fn,
    });

    expect(result.updated).toBe(false);
    expect(stub.calls).toHaveLength(0);
    expect(SessionManager.getCurrentSession()?.headerTitle).toBeUndefined();
  });

  test("generates once the second substantive turn lands", async () => {
    const stub = stubTitle("Heartbeat reconnect loop");

    const result = await manageSessionTitle({
      messages: turns(2),
      model: "deepseek/deepseek-flash",
      generate: stub.fn,
    });

    expect(result.updated).toBe(true);
    expect(result.reason).toBe("generated");
    expect(stub.calls).toHaveLength(1);
    expect(SessionManager.getCurrentSession()?.headerTitle).toBe(
      "Heartbeat reconnect loop"
    );
    expect(SessionManager.getCurrentSession()?.titleMeta?.source).toBe("auto");
  });

  test("skips entirely when no model is available", async () => {
    const stub = stubTitle("Heartbeat reconnect loop");

    const result = await manageSessionTitle({
      messages: turns(2),
      model: null,
      generate: stub.fn,
    });

    expect(result.updated).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });

  test("keeps the title when the topic has not moved", async () => {
    const first = await manageSessionTitle({
      messages: turns(2),
      model: "deepseek/deepseek-flash",
      generate: stubTitle("Session title policy").fn,
    });
    expect(first.updated).toBe(true);

    // At the 10-turn boundary the model returns the same topic again.
    const second = await manageSessionTitle({
      messages: turns(10),
      currentTitle: "Session title policy",
      meta: { source: "auto", lastTitleUserTurns: 2 },
      model: "deepseek/deepseek-flash",
      generate: stubTitle("Session title policy").fn,
    });

    expect(second.updated).toBe(false);
    expect(SessionManager.getCurrentSession()?.headerTitle).toBe(
      "Session title policy"
    );
  });

  test("retitles when the topic actually moved", async () => {
    await manageSessionTitle({
      messages: turns(2),
      model: "deepseek/deepseek-flash",
      generate: stubTitle("Session title policy").fn,
    });

    const result = await manageSessionTitle({
      messages: turns(10),
      currentTitle: "Session title policy",
      meta: { source: "auto", lastTitleUserTurns: 2 },
      model: "deepseek/deepseek-flash",
      generate: stubTitle("Heartbeat reconnect loop").fn,
    });

    expect(result.updated).toBe(true);
    expect(result.reason).toBe("retitled");
    const session = SessionManager.getCurrentSession()!;
    expect(session.headerTitle).toBe("Heartbeat reconnect loop");
    expect(session.titleMeta?.retitleCount).toBe(1);
    expect(session.titleMeta?.lastTitleUserTurns).toBe(10);
  });

  test("never overrides a manually set title", async () => {
    await SessionManager.setHeaderTitle("Hand-picked title", { source: "manual" });
    const stub = stubTitle("Something else entirely");

    const result = await manageSessionTitle({
      messages: turns(20),
      currentTitle: "Hand-picked title",
      meta: { source: "manual" },
      model: "deepseek/deepseek-flash",
      generate: stub.fn,
    });

    expect(result.updated).toBe(false);
    expect(stub.calls).toHaveLength(0);
    expect(SessionManager.getCurrentSession()?.headerTitle).toBe("Hand-picked title");
  });

  test("a rejected title leaves the header untouched", async () => {
    const stub = stubTitle("Code help");

    const result = await manageSessionTitle({
      messages: turns(2),
      model: "deepseek/deepseek-flash",
      generate: stub.fn,
    });

    expect(result.updated).toBe(false);
    expect(SessionManager.getCurrentSession()?.headerTitle).toBeUndefined();
  });
});

describe("automatic title management is invisible", () => {
  beforeEach(async () => {
    SessionStoreInstance.setSaveDelay(60_000);
    await SessionManager.createNew(`zz-manage-silent-${Date.now()}-${Math.random()}`);
    created.push(SessionManager.getCurrentSession()!.id);
  });

  afterEach(cleanup);

  test("emits no header.updated event on its own", async () => {
    const seen: string[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      seen.push(event.type);
    });

    try {
      const result = await manageSessionTitle({
        messages: turns(2),
        model: "deepseek/deepseek-flash",
        generate: stubTitle("Heartbeat reconnect loop").fn,
      });

      expect(result.updated).toBe(true);
      // The helper never publishes; only the caller decides to notify the
      // header line. Nothing here can surface a tool call or status line.
      expect(seen).not.toContain(HeaderEvents.Updated.type);
      expect(seen.filter((t) => t !== "session.updated")).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});
