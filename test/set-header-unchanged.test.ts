import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance } from "../src/session/store.js";
import { Tool } from "../src/tools/registry.js";
import "../src/tools/init.js";

describe("set_header unchanged dedup", () => {
  let sessionID: string | null = null;

  beforeEach(async () => {
    SessionStoreInstance.setSaveDelay(60_000);
    await SessionManager.createNew("set-header-unchanged-test");
    sessionID = SessionManager.getCurrentSession()!.id;
    await Tool.execute("set_header", { title: "Cap smoke test" });
    await SessionManager.flushCurrent();
  });

  // Titles must be unique per project, so a leftover session from a previous
  // run would push these titles to "Cap smoke test (2)" and break the asserts.
  afterEach(async () => {
    SessionStoreInstance.setSaveDelay(1000);
    await SessionManager.exitCurrent();
    if (sessionID) {
      try {
        await SessionStoreInstance.delete(sessionID);
      } catch {
        /* already gone */
      }
      sessionID = null;
    }
  });

  test("returns unchanged metadata when title matches current header", async () => {
    const sessionBefore = SessionManager.getCurrentSession()!;
    const updatedAtBefore = sessionBefore.updated_at;

    const result = await Tool.execute("set_header", { title: "Cap smoke test" });

    expect(result.success).toBe(true);
    expect(result.output).toBe("Header unchanged.");
    expect(result.metadata?.unchanged).toBe(true);

    const sessionAfter = SessionManager.getCurrentSession()!;
    expect(sessionAfter.headerTitle).toBe("Cap smoke test");
    expect(sessionAfter.updated_at).toBe(updatedAtBefore);
  });

  test("updates header when title changes", async () => {
    const result = await Tool.execute("set_header", { title: "New title" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Header updated to:");
    expect(SessionManager.getCurrentSession()?.headerTitle).toBe("New title");
  });
});
