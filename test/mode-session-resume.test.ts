import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance, getCurrentProjectID } from "../src/session/store.js";

describe("persisted session mode migration", () => {
  const created: string[] = [];

  afterEach(async () => {
    await SessionManager.exitCurrent();
    for (const id of created) await SessionManager.deleteSession(id);
    created.length = 0;
  });

  test("load returns and persists canonical modes for legacy and unknown session values", async () => {
    const cases = [
      ["WORK", "AGENT"],
      ["PLAN", "ASK"],
      ["mystery", "ASK"],
    ] as const;

    for (const [persistedMode, canonicalMode] of cases) {
      const id = `mode-resume-${persistedMode}-${Date.now()}-${Math.random()}`;
      created.push(id);
      await SessionStoreInstance.create({
        id,
        name: `${persistedMode} session`,
        projectID: getCurrentProjectID(),
        directory: process.cwd(),
        messages: [],
        mode: persistedMode,
        model: "openai/gpt-5",
        todos: [],
        context_window: 100_000,
        cost: 0,
        metadata: {},
      });

      const resumed = await SessionManager.load(id);
      expect(resumed.mode).toBe(canonicalMode);
      expect(SessionManager.getCurrentSession()?.mode).toBe(canonicalMode);
      expect((await SessionStoreInstance.read(id)).mode).toBe(canonicalMode);
    }
  });

  test("resume inspection normalizes legacy mode without persisting or switching sessions", async () => {
    const currentId = `mode-current-${Date.now()}-${Math.random()}`;
    const targetId = `mode-inspect-${Date.now()}-${Math.random()}`;
    created.push(currentId, targetId);

    for (const [id, mode] of [[currentId, "ASK"], [targetId, "PLAN"]] as const) {
      await SessionStoreInstance.create({
        id,
        name: id,
        projectID: getCurrentProjectID(),
        directory: process.cwd(),
        messages: [],
        mode,
        model: "openai/gpt-5",
        todos: [],
        context_window: 100_000,
        cost: 0,
        metadata: {},
      });
    }
    await SessionManager.load(currentId);

    const inspected = await SessionManager.inspectForResume(targetId);

    expect(inspected.mode).toBe("ASK");
    expect(SessionManager.getCurrentSessionID()).toBe(currentId);
    expect((await SessionStoreInstance.read(targetId)).mode).toBe("PLAN");
  });
});
