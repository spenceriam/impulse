import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Bus, SessionEvents } from "../src/bus/index.js";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance } from "../src/session/store.js";
import { getCurrentProjectID } from "../src/session/store.js";
import { setCurrentMode } from "../src/tools/mode-state.js";

describe("session update generations", () => {
  const created = new Set<string>();
  let project: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-session-update-generation-"));
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

  test("/new waits for an admitted old update and it cannot reclaim the replacement", async () => {
    const old = await SessionManager.createNew("old-update-target");
    created.add(old.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const update = SessionStoreInstance.update.bind(SessionStoreInstance);
    const updateSpy = spyOn(SessionStoreInstance, "update").mockImplementation(
      async (sessionId, patch, guard) => {
        started();
        await gate;
        return update(sessionId, patch, guard);
      }
    );

    try {
      const staleUpdate = SessionManager.update({
        headerTitle: "stale old title",
        metadata: { stale: true },
      });
      await didStart;

      const replacementPromise = SessionManager.createNew("replacement-current");
      let replacementSettled = false;
      void replacementPromise.finally(() => { replacementSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(replacementSettled).toBe(false);
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      release();
      const replacement = await replacementPromise;
      created.add(replacement.id);
      await staleUpdate;

      expect(SessionManager.getCurrentSessionID()).toBe(replacement.id);
      expect(SessionManager.getCurrentSession()?.headerTitle).toBeUndefined();
      expect(SessionManager.getCurrentSession()?.metadata).toEqual({});
      expect((await SessionStoreInstance.read(replacement.id)).metadata).toEqual({});
      expect((await SessionStoreInstance.read(old.id)).headerTitle).toBe("stale old title");
    } finally {
      release();
      updateSpy.mockRestore();
    }
  });

  test("resume waits for an admitted old update and installs only the target", async () => {
    const old = await SessionManager.createNew("old-before-resume");
    created.add(old.id);
    const target = await SessionStoreInstance.create({
      id: `resume-target-${Date.now()}-${Math.random()}`,
      name: "resume-target",
      projectID: getCurrentProjectID(),
      directory: project,
      messages: [],
      mode: "ASK",
      model: "resume/model",
      todos: [],
      context_window: 100_000,
      cost: 0,
      metadata: { replacement: true },
    });
    created.add(target.id);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const update = SessionStoreInstance.update.bind(SessionStoreInstance);
    const updateSpy = spyOn(SessionStoreInstance, "update").mockImplementation(
      async (sessionId, patch, guard) => {
        started();
        await gate;
        return update(sessionId, patch, guard);
      }
    );

    try {
      const staleUpdate = SessionManager.update({
        mode: "AGENT",
        metadata: { stale: true },
      });
      await didStart;
      const resumedPromise = SessionManager.load(target.id);
      let resumeSettled = false;
      void resumedPromise.finally(() => { resumeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resumeSettled).toBe(false);
      expect(SessionManager.getCurrentSessionID()).toBe(old.id);
      release();
      const resumed = await resumedPromise;
      await staleUpdate;

      expect(resumed.id).toBe(target.id);
      expect(SessionManager.getCurrentSessionID()).toBe(target.id);
      expect(SessionManager.getCurrentSession()?.mode).toBe("ASK");
      expect(SessionManager.getCurrentSession()?.metadata).toEqual({ replacement: true });
      expect((await SessionStoreInstance.read(target.id)).metadata).toEqual({ replacement: true });
      expect((await SessionStoreInstance.read(old.id)).metadata).toEqual({ stale: true });
    } finally {
      release();
      updateSpy.mockRestore();
    }
  });

  test("concurrent updates to the same generation preserve both fields", async () => {
    const session = await SessionManager.createNew("concurrent-updates");
    created.add(session.id);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const didStartFirst = new Promise<void>((resolve) => { firstStarted = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    const updateSpy = spyOn(SessionStoreInstance, "update").mockImplementation(
      async (sessionId, patch, _guard) => {
        const draft = await SessionStoreInstance.read(sessionId);
        if ("headerTitle" in patch) {
          firstStarted();
          await firstGate;
        }
        Object.assign(draft, patch);
        await writeSnapshot(draft);
        return draft;
      }
    );

    try {
      const titleUpdate = SessionManager.update({ headerTitle: "serialized title" });
      await didStartFirst;
      const metadataUpdate = SessionManager.update({ metadata: { preserved: true } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      releaseFirst();
      await Promise.all([titleUpdate, metadataUpdate]);

      expect(SessionManager.getCurrentSession()?.headerTitle).toBe("serialized title");
      expect(SessionManager.getCurrentSession()?.metadata).toEqual({ preserved: true });
      const persisted = await SessionStoreInstance.read(session.id);
      expect(persisted.headerTitle).toBe("serialized title");
      expect(persisted.metadata).toEqual({ preserved: true });
    } finally {
      releaseFirst();
      updateSpy.mockRestore();
    }
  });

  test("an update from an older generation cannot cross a same-ID resume", async () => {
    const session = await SessionManager.createNew("same-id-generation");
    created.add(session.id);
    await SessionManager.update({ metadata: { replacement: true } });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const update = SessionStoreInstance.update.bind(SessionStoreInstance);
    const updateSpy = spyOn(SessionStoreInstance, "update").mockImplementation(
      async (sessionId, patch, guard) => {
        started();
        await gate;
        return update(sessionId, patch, guard);
      }
    );

    try {
      const staleUpdate = SessionManager.update({ metadata: { stale: true } });
      await didStart;
      const resumedPromise = SessionManager.load(session.id);
      let resumeSettled = false;
      void resumedPromise.finally(() => { resumeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resumeSettled).toBe(false);
      release();
      const resumed = await resumedPromise;
      await staleUpdate;

      expect(resumed.metadata).toEqual({ replacement: true });
      expect(SessionManager.getCurrentSessionID()).toBe(session.id);
      expect(SessionManager.getCurrentSession()?.metadata).toEqual({ replacement: true });
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({ replacement: true });
    } finally {
      release();
      updateSpy.mockRestore();
    }
  });

  test("same-ID resume fences a write paused at atomic promotion", async () => {
    const session = await SessionManager.createNew("same-id-promotion-fence");
    created.add(session.id);
    await SessionManager.update({ metadata: { replacement: true } });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (candidate) => {
        const stage = await stageSnapshot(candidate);
        if (candidate.metadata?.["stalePromotion"] !== true) return stage;
        return {
          ...stage,
          async commitIfWithLease(lease, canCommit) {
            started();
            await gate;
            return stage.commitIfWithLease(lease, canCommit);
          },
        };
      }
    );
    const staleEvents: unknown[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type !== SessionEvents.Updated.name) return;
      const properties = event.properties as { session?: { metadata?: Record<string, unknown> } };
      if (properties.session?.metadata?.["stalePromotion"] === true) {
        staleEvents.push(properties);
      }
    });
    let staleUpdate: Promise<unknown> | undefined;

    try {
      staleUpdate = SessionManager.update({ metadata: { stalePromotion: true } });
      await Promise.race([
        didStart,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("session update never reached staged promotion")), 100)
        ),
      ]);

      const resumed = SessionManager.load(session.id);
      release();
      await Promise.all([staleUpdate, resumed]);

      expect(SessionManager.getCurrentSession()?.metadata).toEqual({ replacement: true });
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({ replacement: true });
      expect(staleEvents).toEqual([]);
    } finally {
      release();
      await staleUpdate?.catch(() => {});
      unsubscribe();
      stageSpy.mockRestore();
    }
  });

  test("same-ID resume wins when old session promotion was already admitted", async () => {
    const session = await SessionManager.createNew("same-id-admitted-promotion");
    created.add(session.id);
    await SessionManager.update({ metadata: { replacement: true } });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let finishPromotion!: () => void;
    const promotionGate = new Promise<void>((resolve) => { finishPromotion = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    let promoted!: () => void;
    const didPromote = new Promise<void>((resolve) => { promoted = resolve; });
    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (candidate) => {
        const stage = await stageSnapshot(candidate);
        if (candidate.metadata?.["admittedStalePromotion"] !== true) return stage;
        return {
          ...stage,
          async commitIfWithLease(lease, canCommit) {
            const admitted = canCommit();
            started();
            await gate;
            if (!admitted) return stage.commitIfWithLease(lease, () => false);
            await stage.commitWithLease(lease);
            promoted();
            await promotionGate;
            return true;
          },
        };
      }
    );
    const staleEvents: unknown[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type !== SessionEvents.Updated.name) return;
      const properties = event.properties as { session?: { metadata?: Record<string, unknown> } };
      if (properties.session?.metadata?.["admittedStalePromotion"] === true) {
        staleEvents.push(properties);
      }
    });

    const originalGeneration = SessionManager.captureCurrentSessionMutation()!.generation;
    let staleUpdate: Promise<unknown> | undefined;
    let resumedPromise: Promise<unknown> | undefined;
    try {
      staleUpdate = SessionManager.update({
        metadata: { admittedStalePromotion: true },
      });
      await didStart;
      resumedPromise = SessionManager.load(session.id);
      let resumeSettled = false;
      void resumedPromise.finally(() => { resumeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resumeSettled).toBe(false);
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(
        originalGeneration
      );
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({
        replacement: true,
      });

      release();
      await didPromote;
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({
        admittedStalePromotion: true,
      });
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(
        originalGeneration
      );

      finishPromotion();
      const [resumed] = await Promise.all([resumedPromise, staleUpdate]);

      expect(resumed.metadata).toEqual({ replacement: true });
      expect(SessionManager.getCurrentSession()?.metadata).toEqual({ replacement: true });
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({ replacement: true });
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(
        originalGeneration + 1
      );
      expect(staleEvents).toEqual([]);
    } finally {
      release();
      finishPromotion();
      await Promise.all([
        staleUpdate?.catch(() => {}),
        resumedPromise?.catch(() => {}),
      ]);
      unsubscribe();
      stageSpy.mockRestore();
    }
  });

  test("debounced message promotion holds generation until rename completes", async () => {
    const session = await SessionManager.createNew("message-promotion-lease");
    created.add(session.id);
    const originalGeneration = SessionManager.captureCurrentSessionMutation()!.generation;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let finishPromotion!: () => void;
    const promotionGate = new Promise<void>((resolve) => { finishPromotion = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    let promoted!: () => void;
    const didPromote = new Promise<void>((resolve) => { promoted = resolve; });
    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (candidate) => {
        const stage = await stageSnapshot(candidate);
        if (candidate.messages.length !== 1 || candidate.messages[0]?.content !== "old message") {
          return stage;
        }
        return {
          ...stage,
          async commitIfWithLease(lease, canCommit) {
            const admitted = canCommit();
            started();
            await gate;
            if (!admitted) return stage.commitIfWithLease(lease, () => false);
            await stage.commitWithLease(lease);
            promoted();
            await promotionGate;
            return true;
          },
        };
      }
    );

    SessionStoreInstance.setSaveDelay(0);
    try {
      await SessionManager.addMessage({
        role: "user",
        content: "old message",
        timestamp: new Date().toISOString(),
      });
      await didStart;

      SessionStoreInstance.setSaveDelay(1_000);
      await SessionManager.addMessage({
        role: "user",
        content: "replacement message",
        timestamp: new Date().toISOString(),
      });
      const resumedPromise = SessionManager.load(session.id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(
        originalGeneration
      );

      release();
      await didPromote;
      expect((await SessionStoreInstance.read(session.id)).messages.map((message) => message.content))
        .toEqual(["old message"]);
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(
        originalGeneration
      );

      finishPromotion();
      const resumed = await resumedPromise;
      expect(resumed.messages.map((message) => message.content)).toEqual([
        "old message",
        "replacement message",
      ]);
      expect((await SessionStoreInstance.read(session.id)).messages.map((message) => message.content))
        .toEqual(["old message", "replacement message"]);
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(
        originalGeneration + 1
      );
    } finally {
      release();
      finishPromotion();
      SessionStoreInstance.setSaveDelay(1_000);
      stageSpy.mockRestore();
    }
  });

  for (const failure of ["rename", "directory fsync"] as const) {
    test(`${failure} failure releases the session commit lease`, async () => {
      const session = await SessionManager.createNew(`${failure}-lease-failure`);
      created.add(session.id);
      const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
      let rollbacks = 0;
      const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
        async (candidate) => {
          const stage = await stageSnapshot(candidate);
          if (candidate.metadata?.["promotionFailure"] !== failure) return stage;
          return {
            ...stage,
            async commitIfWithLease() {
              throw new Error(`injected ${failure} failure`);
            },
            async rollback() {
              rollbacks++;
              await stage.rollback();
            },
          };
        }
      );

      try {
        await expect(
          SessionManager.update({ metadata: { promotionFailure: failure } })
        ).rejects.toThrow(`injected ${failure} failure`);
        expect(rollbacks).toBe(1);
      } finally {
        stageSpy.mockRestore();
      }

      await expect(
        SessionManager.update({ metadata: { recoveredAfter: failure } })
      ).resolves.toMatchObject({ metadata: { recoveredAfter: failure } });
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({
        recoveredAfter: failure,
      });
    });
  }

  test("a failed update leaves the current generation intact and does not poison later updates", async () => {
    const session = await SessionManager.createNew("update-failure");
    created.add(session.id);
    const update = SessionStoreInstance.update.bind(SessionStoreInstance);
    let calls = 0;
    const updateSpy = spyOn(SessionStoreInstance, "update").mockImplementation(
      async (sessionId, patch, guard) => {
        calls++;
        if (calls === 1) throw new Error("injected update failure");
        return update(sessionId, patch, guard);
      }
    );

    try {
      const failed = SessionManager.update({ headerTitle: "must not apply" });
      const succeeding = SessionManager.update({ metadata: { afterFailure: true } });
      await expect(failed).rejects.toThrow("injected update failure");
      await expect(succeeding).resolves.toMatchObject({
        id: session.id,
        metadata: { afterFailure: true },
      });

      expect(SessionManager.getCurrentSessionID()).toBe(session.id);
      expect(SessionManager.getCurrentSession()?.headerTitle).toBeUndefined();
      expect(SessionManager.getCurrentSession()?.metadata).toEqual({ afterFailure: true });
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({ afterFailure: true });
    } finally {
      updateSpy.mockRestore();
    }
  });
});
