import { describe, expect, test } from "bun:test";
import { createSyncEvent } from "../src/session/sync-protocol.js";

describe("createSyncEvent", () => {
  test("creates a sync event envelope", () => {
    const event = createSyncEvent({
      type: "session.status.changed",
      sessionID: "sess_1",
      projectID: "proj_1",
      payload: { status: "idle" },
    });

    expect(event.id).toStartWith("sync_");
    expect(event.sessionID).toBe("sess_1");
    expect(event.payload).toEqual({ status: "idle" });
  });
});
