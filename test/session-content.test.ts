import { describe, expect, test } from "bun:test";
import {
  sessionHasResumeableContent,
  summarizeSessions,
} from "../src/session/session-content.js";
import type { Session } from "../src/session/store.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess_test",
    name: "Session May 25 at 02:07 PM",
    projectID: "proj",
    directory: "/tmp",
    created_at: "2026-05-25T12:00:00.000Z",
    updated_at: "2026-05-25T14:00:00.000Z",
    messages: [],
    mode: "AGENT",
    model: "",
    todos: [],
    context_window: 200000,
    cost: 0,
    ...overrides,
  };
}

describe("sessionHasResumeableContent", () => {
  test("false when no messages", () => {
    expect(sessionHasResumeableContent(makeSession())).toBe(false);
  });

  test("false when only assistant messages", () => {
    expect(
      sessionHasResumeableContent(
        makeSession({
          messages: [
            {
              role: "assistant",
              content: "hi",
              timestamp: "2026-05-25T12:00:00.000Z",
            },
          ],
        })
      )
    ).toBe(false);
  });

  test("true when at least one user message", () => {
    expect(
      sessionHasResumeableContent(
        makeSession({
          messages: [
            {
              role: "user",
              content: "hello",
              timestamp: "2026-05-25T12:00:00.000Z",
            },
          ],
        })
      )
    ).toBe(true);
  });
});

describe("summarizeSessions", () => {
  test("returns numeric fields", async () => {
    const summary = await summarizeSessions("current");
    expect(summary.total).toBeGreaterThanOrEqual(0);
    expect(summary.resumeable + summary.empty).toBe(summary.total);
  });
});
