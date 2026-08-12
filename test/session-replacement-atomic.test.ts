import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { SessionManager } from "../src/session/manager.js";
import {
  SessionStoreInstance,
  getCurrentProjectID,
  type Session,
} from "../src/session/store.js";
import { Bus, SessionEvents } from "../src/bus/index.js";
import { resumeSessionWithAuthority } from "../src/session/resume-authority.js";
import { getCurrentMode, setCurrentMode } from "../src/tools/mode-state.js";
import { getExecutionAdmissionState } from "../src/tools/execution-admission.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

async function createStoredSession(id: string, mode: string): Promise<Session> {
  return SessionStoreInstance.create({
    id,
    name: id,
    projectID: getCurrentProjectID(),
    directory: process.cwd(),
    messages: [],
    mode,
    model: "test/model",
    todos: [],
    context_window: 100_000,
    cost: 0,
    metadata: {},
  });
}

describe("atomic session replacement", () => {
  const created = new Set<string>();

  afterEach(async () => {
    await SessionManager.exitCurrent();
    for (const id of created) await SessionManager.deleteSession(id);
    created.clear();
    setCurrentMode("ASK");
  });

  test("canonical target write failure leaves the old session current and target unchanged", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const oldId = `replace-old-${suffix}`;
    const targetId = `replace-target-${suffix}`;
    created.add(oldId);
    created.add(targetId);
    await createStoredSession(oldId, "AGENT");
    await createStoredSession(targetId, "PLAN");
    await SessionManager.load(oldId);

    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (session) => {
        if (session.id === targetId) throw new Error("injected canonical write failure");
        return stageSnapshot(session);
      }
    );

    try {
      await expect(SessionManager.load(targetId)).rejects.toThrow(
        "injected canonical write failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(oldId);
      expect((await SessionStoreInstance.read(targetId)).mode).toBe("PLAN");
    } finally {
      stageSpy.mockRestore();
    }
  });

  test("old-session finalization failure leaves the old session current and target unchanged", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const oldId = `finalize-old-${suffix}`;
    const targetId = `finalize-target-${suffix}`;
    created.add(oldId);
    created.add(targetId);
    await createStoredSession(oldId, "AGENT");
    await createStoredSession(targetId, "PLAN");
    await SessionManager.load(oldId);

    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (session) => {
        if (session.id === oldId) throw new Error("injected old finalization failure");
        return writeSnapshot(session);
      }
    );

    try {
      await expect(SessionManager.load(targetId)).rejects.toThrow(
        "injected old finalization failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(oldId);
      expect((await SessionStoreInstance.read(targetId)).mode).toBe("PLAN");
    } finally {
      writeSpy.mockRestore();
    }
  });

  test("target activation failure restores the old session and original target storage", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const oldId = `activate-old-${suffix}`;
    const targetId = `activate-target-${suffix}`;
    created.add(oldId);
    created.add(targetId);
    await createStoredSession(oldId, "AGENT");
    await createStoredSession(targetId, "PLAN");
    await SessionManager.load(oldId);

    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (session) => {
        const stage = await stageSnapshot(session);
        if (session.id !== targetId) return stage;
        return {
          ...stage,
          commit: async () => {
            throw new Error("injected target activation failure");
          },
        };
      }
    );

    try {
      await expect(SessionManager.load(targetId)).rejects.toThrow(
        "injected target activation failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(oldId);
      expect((await SessionStoreInstance.read(targetId)).mode).toBe("PLAN");
    } finally {
      stageSpy.mockRestore();
    }
  });

  test("rollback failure reports both errors without losing the old session or target", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const oldId = `rollback-old-${suffix}`;
    const targetId = `rollback-target-${suffix}`;
    created.add(oldId);
    created.add(targetId);
    await createStoredSession(oldId, "AGENT");
    await createStoredSession(targetId, "PLAN");
    await SessionManager.load(oldId);

    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (session) => {
        const stage = await stageSnapshot(session);
        if (session.id !== targetId) return stage;
        return {
          ...stage,
          commit: async () => {
            throw new Error("injected target activation failure");
          },
          rollback: async () => {
            await stage.rollback();
            throw new Error("injected target rollback failure");
          },
        };
      }
    );

    try {
      let failure: unknown;
      try {
        await SessionManager.load(targetId);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as Error).message).toContain("injected target activation failure");
      expect((failure as Error).message).toContain("injected target rollback failure");
      expect(SessionManager.getCurrentSessionID()).toBe(oldId);
      expect((await SessionStoreInstance.read(targetId)).mode).toBe("PLAN");
    } finally {
      stageSpy.mockRestore();
    }
  });

  test("successful replacement persists one canonical update and installs the target", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const oldId = `success-old-${suffix}`;
    const targetId = `success-target-${suffix}`;
    created.add(oldId);
    created.add(targetId);
    await createStoredSession(oldId, "AGENT");
    await createStoredSession(targetId, "PLAN");
    await SessionManager.load(oldId);

    let canonicalUpdates = 0;
    const unsubscribe = Bus.subscribe((event) => {
      if (
        event.type === SessionEvents.Updated.name &&
        (event.properties as { sessionID?: string }).sessionID === targetId
      ) {
        canonicalUpdates++;
      }
    });

    try {
      const resumed = await SessionManager.load(targetId);
      expect(resumed.mode).toBe("ASK");
      expect(SessionManager.getCurrentSessionID()).toBe(targetId);
      expect((await SessionStoreInstance.read(targetId)).mode).toBe("ASK");
      expect(canonicalUpdates).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  test("failed real resume restores the old session and coherent AGENT admission", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const oldId = `authority-old-${suffix}`;
    const targetId = `authority-target-${suffix}`;
    created.add(oldId);
    created.add(targetId);
    await createStoredSession(oldId, "AGENT");
    await createStoredSession(targetId, "PLAN");
    await SessionManager.load(oldId);
    await enterAgentModeForTest();

    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (session) => {
        const stage = await stageSnapshot(session);
        if (session.id !== targetId) return stage;
        return {
          ...stage,
          commit: async () => {
            throw new Error("injected real resume activation failure");
          },
        };
      }
    );

    try {
      await expect(resumeSessionWithAuthority({
        currentMode: "AGENT",
        inspect: () => SessionManager.inspectForResume(targetId),
        commit: () => SessionManager.load(targetId),
      })).rejects.toThrow("injected real resume activation failure");

      expect(SessionManager.getCurrentSessionID()).toBe(oldId);
      expect(SessionManager.getCurrentSession()?.name).toBe(oldId);
      expect((await SessionStoreInstance.read(targetId)).mode).toBe("PLAN");
      expect(getCurrentMode()).toBe("AGENT");
      expect(getExecutionAdmissionState()).toBe("open");
    } finally {
      stageSpy.mockRestore();
    }
  });
});
