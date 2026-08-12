import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance } from "../src/session/store.js";
import { Bus, SessionEvents } from "../src/bus/index.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { getCurrentMode } from "../src/tools/mode-state.js";
import { getExecutionAdmissionState } from "../src/tools/execution-admission.js";
import { cleanupExecutionParticipants } from "../src/tools/execution-revocation.js";
import { createNewSessionWithAuthority } from "../src/session/new-session-authority.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

describe("atomic new-session creation", () => {
  const created = new Set<string>();
  let project: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-session-create-"));
    process.chdir(project);
    SessionManager.setOptions({
      defaultMode: "ASK",
      defaultModel: "test/model",
      initialContextWindow: 100_000,
    });
    setCurrentMode("ASK");
  });

  afterEach(async () => {
    await SessionManager.exitCurrent();
    for (const id of created) await SessionStoreInstance.delete(id).catch(() => {});
    created.clear();
    process.chdir(originalCwd);
    fs.rmSync(project, { recursive: true, force: true });
    setCurrentMode("ASK");
  });

  test("durable creation failure retains the old current session", async () => {
    const old = await SessionManager.createNew("old-current");
    created.add(old.id);

    const createSpy = spyOn(SessionStoreInstance, "stageCreate").mockImplementation(
      async (session) => {
        created.add(session.id);
        throw new Error("injected new-session create failure");
      }
    );

    try {
      await expect(SessionManager.createNew("replacement")).rejects.toThrow(
        "injected new-session create failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      expect((await SessionStoreInstance.read(old.id)).name).toBe("old-current");
    } finally {
      createSpy.mockRestore();
    }
  });

  test("old-session finalization failure removes the staged replacement", async () => {
    const old = await SessionManager.createNew("old-before-finalize");
    created.add(old.id);
    let replacementId = "";

    const stageCreate = SessionStoreInstance.stageCreate.bind(SessionStoreInstance);
    const createSpy = spyOn(SessionStoreInstance, "stageCreate").mockImplementation(
      async (session) => {
        replacementId = session.id;
        created.add(session.id);
        return stageCreate(session);
      }
    );
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (session) => {
        if (session.id === old.id) throw new Error("injected old-session finalization failure");
        return writeSnapshot(session);
      }
    );

    try {
      await expect(SessionManager.createNew("orphan-candidate")).rejects.toThrow(
        "injected old-session finalization failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      await expect(SessionStoreInstance.read(replacementId)).rejects.toThrow();
      expect((await SessionStoreInstance.read(old.id)).name).toBe("old-before-finalize");
    } finally {
      createSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });

  test("promotion failure removes a partially durable replacement", async () => {
    const old = await SessionManager.createNew("old-before-promotion");
    created.add(old.id);
    let replacementId = "";

    const stageCreate = SessionStoreInstance.stageCreate.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageCreate").mockImplementation(
      async (session) => {
        replacementId = session.id;
        created.add(session.id);
        const stage = await stageCreate(session);
        return {
          ...stage,
          commit: async () => {
            await stage.commit();
            throw new Error("injected promotion failure");
          },
        };
      }
    );

    try {
      await expect(SessionManager.createNew("partially-promoted")).rejects.toThrow(
        "injected promotion failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      await expect(SessionStoreInstance.read(replacementId)).rejects.toThrow();
      expect((await SessionStoreInstance.read(old.id)).name).toBe("old-before-promotion");
    } finally {
      stageSpy.mockRestore();
    }
  });

  test("target activation failure restores the old pointer and removes the candidate", async () => {
    const old = await SessionManager.createNew("old-before-activation");
    created.add(old.id);
    let replacementId = "";

    const stageCreate = SessionStoreInstance.stageCreate.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageCreate").mockImplementation(
      async (session) => {
        replacementId = session.id;
        created.add(session.id);
        const stage = await stageCreate(session);
        return {
          ...stage,
          activate: async () => {
            await stage.activate();
            throw new Error("injected new-session activation failure");
          },
        };
      }
    );

    try {
      await expect(SessionManager.createNew("activation-candidate")).rejects.toThrow(
        "injected new-session activation failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      await expect(SessionStoreInstance.read(replacementId)).rejects.toThrow();
      expect((await SessionStoreInstance.read(old.id)).name).toBe("old-before-activation");
    } finally {
      stageSpy.mockRestore();
    }
  });

  test("rollback failure reports both errors while retaining the old current session", async () => {
    const old = await SessionManager.createNew("old-before-rollback");
    created.add(old.id);

    const stageCreate = SessionStoreInstance.stageCreate.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageCreate").mockImplementation(
      async (session) => {
        created.add(session.id);
        const stage = await stageCreate(session);
        return {
          ...stage,
          commit: async () => {
            throw new Error("injected new-session primary failure");
          },
          rollback: async () => {
            await stage.rollback();
            throw new Error("injected orphan cleanup failure");
          },
        };
      }
    );

    try {
      let failure: unknown;
      try {
        await SessionManager.createNew("rollback-candidate");
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as Error).message).toContain("injected new-session primary failure");
      expect((failure as Error).message).toContain("injected orphan cleanup failure");
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      expect((await SessionStoreInstance.read(old.id)).name).toBe("old-before-rollback");
    } finally {
      stageSpy.mockRestore();
    }
  });

  test("successful replacement installs exactly one new ASK session", async () => {
    const old = await SessionManager.createNew("old-before-success");
    created.add(old.id);
    SessionManager.setOptions({ defaultMode: "AGENT" });
    let createdEvents = 0;
    const unsubscribe = Bus.subscribe((event) => {
      if (
        event.type === SessionEvents.Created.name &&
        (event.properties as { session?: { name?: string } }).session?.name === "new-success"
      ) {
        createdEvents++;
      }
    });

    try {
      const replacement = await SessionManager.createNew("new-success");
      created.add(replacement.id);

      expect(replacement.mode).toBe("ASK");
      expect(SessionManager.getCurrentSessionID()).toBe(replacement.id);
      expect((await SessionStoreInstance.read(replacement.id)).mode).toBe("ASK");
      expect((await SessionManager.listSessions()).filter((s) => s.name === "new-success")).toHaveLength(1);
      expect(createdEvents).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  test("failed /new creation restores the old AGENT runtime after lifecycle cleanup", async () => {
    const old = await SessionManager.createNew("old-agent-ui");
    created.add(old.id);
    await enterAgentModeForTest();
    expect((await cleanupExecutionParticipants("new-session")).ok).toBe(true);
    expect(getExecutionAdmissionState()).toBe("closed");

    const stageSpy = spyOn(SessionStoreInstance, "stageCreate").mockImplementation(
      async () => {
        throw new Error("injected /new creation failure");
      }
    );

    try {
      const result = await createNewSessionWithAuthority({
        currentMode: "AGENT",
        create: () => SessionManager.createNew("failed-new-ui"),
      });

      expect(result).toMatchObject({
        ok: false,
        mode: "AGENT",
        notice: "New session failed -- continuing old session in AGENT: injected /new creation failure",
      });
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      expect(getCurrentMode()).toBe("AGENT");
      expect(getExecutionAdmissionState()).toBe("open");
    } finally {
      stageSpy.mockRestore();
    }
  });

  test("successful /new from AGENT installs the replacement under ASK authority", async () => {
    const old = await SessionManager.createNew("old-agent-success");
    created.add(old.id);
    await enterAgentModeForTest();
    expect((await cleanupExecutionParticipants("new-session")).ok).toBe(true);

    const result = await createNewSessionWithAuthority({
      currentMode: "AGENT",
      create: () => SessionManager.createNew("new-ask-runtime"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    created.add(result.session.id);

    expect(result.mode).toBe("ASK");
    expect(result.session.mode).toBe("ASK");
    expect(SessionManager.getCurrentSessionID()).toBe(result.session.id);
    expect(getCurrentMode()).toBe("ASK");
    expect(getExecutionAdmissionState()).toBe("ask");
    expect((await SessionStoreInstance.read(old.id)).name).toBe("old-agent-success");
  });
});
