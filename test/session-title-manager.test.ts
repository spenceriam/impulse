import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Bus, HeaderEvents } from "../src/bus/index.js";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance } from "../src/session/store.js";
import { decideTitleAction } from "../src/session/title-decision.js";
import type { Message } from "../src/session/store.js";
import { TITLE_MAX_LENGTH } from "../src/util/title-policy.js";

const created: string[] = [];

function turn(content = "do some work"): Message[] {
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
    {
      role: "tool",
      content: "ok",
      tool_call_id: "call_x",
      timestamp: new Date().toISOString(),
    },
  ];
}

async function freshSession(name: string): Promise<string> {
  await SessionManager.createNew(name);
  const id = SessionManager.getCurrentSession()!.id;
  created.push(id);
  return id;
}

/** Delete every session this file created, so the project is left as found. */
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

describe("session title enforcement", () => {
  beforeEach(async () => {
    SessionStoreInstance.setSaveDelay(60_000);
    await freshSession(`zz-title-policy-${Date.now()}-${Math.random()}`);
  });

  afterEach(cleanup);

  test("stores an accepted title with auto source metadata", async () => {
    const result = await SessionManager.setHeaderTitle("Heartbeat reconnect loop", {
      source: "auto",
      meta: { lastTitleUserTurns: 2, retitleCount: 0 },
    });

    expect(result.rejected).toBe(false);
    // A sibling in the same project may already own the exact title, in which
    // case a discriminator is appended. The label must still be preserved.
    expect(result.title).toStartWith("Heartbeat reconnect loop");
    expect(result.title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);

    const session = SessionManager.getCurrentSession()!;
    expect(session.headerTitle).toBe(result.title);
    expect(session.titleMeta?.source).toBe("auto");
    expect(session.titleMeta?.lastTitleUserTurns).toBe(2);
  });

  test("marks manual titles so the generator cannot overwrite them", async () => {
    await SessionManager.setHeaderTitle("Hand-picked title", { source: "manual" });
    expect(SessionManager.getCurrentSession()?.titleMeta?.source).toBe("manual");
  });

  test("rejects a generic title without changing the header", async () => {
    await SessionManager.setHeaderTitle("Heartbeat reconnect loop", { source: "auto" });
    const before = SessionManager.getCurrentSession()!.headerTitle;

    const result = await SessionManager.setHeaderTitle("Code help", { source: "auto" });

    expect(result.rejected).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(SessionManager.getCurrentSession()?.headerTitle).toBe(before);
  });

  test("rejects an over-cap title", async () => {
    const result = await SessionManager.setHeaderTitle(
      "Refactor the entire session title generation pipeline today",
      { source: "auto" }
    );

    expect(result.rejected).toBe(true);
    expect(result.reason).toContain(String(TITLE_MAX_LENGTH));
  });

  test("repeating a title is a no-op, even when it was disambiguated", async () => {
    const first = await SessionManager.setHeaderTitle("Heartbeat reconnect loop", {
      source: "auto",
    });
    const updatedAt = SessionManager.getCurrentSession()!.updated_at;

    const second = await SessionManager.setHeaderTitle("Heartbeat reconnect loop", {
      source: "auto",
    });

    expect(second.unchanged).toBe(true);
    expect(second.rejected).toBe(false);
    expect(second.title).toBe(first.title);
    expect(SessionManager.getCurrentSession()!.updated_at).toBe(updatedAt);
  });

  test("disambiguates a collision with another session in the project", async () => {
    const first = await SessionManager.setHeaderTitle("Session title policy", {
      source: "auto",
    });
    await SessionManager.flushCurrent();

    await freshSession(`zz-title-collision-${Date.now()}-${Math.random()}`);
    const second = await SessionManager.setHeaderTitle("Session title policy", {
      source: "auto",
    });

    // Whichever suffix the first session took, the two must differ.
    expect(second.title).not.toBe(first.title);
    expect(second.title).toMatch(/^Session title policy( \(\d+\))?$/);
    expect(second.title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(SessionManager.getCurrentSession()?.headerTitle).toBe(second.title);
  });

  test("a manual title is never reconsidered at the 10-turn boundary", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 12; i++) messages.push(...turn(`task ${i}`));

    expect(
      decideTitleAction({
        messages,
        currentTitle: "Hand-picked title",
        meta: { source: "manual" },
      })
    ).toEqual({ action: "skip" });
  });
});

describe("automatic title management stays invisible", () => {
  beforeEach(async () => {
    SessionStoreInstance.setSaveDelay(60_000);
    await freshSession(`zz-title-silent-${Date.now()}-${Math.random()}`);
  });

  afterEach(cleanup);

  test("no header-updated or tool event is emitted for a silent title change", async () => {
    const seen: string[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      seen.push(event.type);
    });

    try {
      // What the automatic path does when the topic moved: store the new title
      // directly, without publishing HeaderEvents.Updated.
      const result = await SessionManager.setHeaderTitle("Heartbeat reconnect loop", {
        source: "auto",
        meta: { lastTitleUserTurns: 10, retitleCount: 1 },
      });

      expect(result.rejected).toBe(false);
      expect(seen).not.toContain(HeaderEvents.Updated.type);
      // session.updated is the persistence event; it renders nothing in chat.
      expect(seen.filter((t) => t !== "session.updated")).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  test("rejected and unchanged silent attempts emit nothing either", async () => {
    const seen: string[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      seen.push(event.type);
    });

    try {
      const rejected = await SessionManager.setHeaderTitle("Question", {
        source: "auto",
      });
      expect(rejected.rejected).toBe(true);

      const empty = await SessionManager.resolveHeaderTitle("");
      expect(empty.rejected).toBe(true);

      expect(seen.filter((t) => t !== "session.updated")).toEqual([]);
      expect(seen).not.toContain(HeaderEvents.Updated.type);
    } finally {
      unsubscribe();
    }
  });
});
