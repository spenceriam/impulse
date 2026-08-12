import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Bus, SessionEvents } from "../src/bus/index.js";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance } from "../src/session/store.js";
import { setCurrentMode } from "../src/tools/mode-state.js";

describe("session flush generations", () => {
  const created = new Set<string>();
  let project: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-session-flush-generation-"));
    process.chdir(project);
    SessionManager.setOptions({
      defaultMode: "ASK",
      defaultModel: "test/model",
      initialContextWindow: 100_000,
    });
    setCurrentMode("ASK");
  });

  afterEach(async () => {
    SessionStoreInstance.setSaveDelay(1_000);
    await SessionManager.exitCurrent();
    for (const id of created) await SessionStoreInstance.delete(id).catch(() => {});
    created.clear();
    process.chdir(originalCwd);
    fs.rmSync(project, { recursive: true, force: true });
    setCurrentMode("ASK");
  });

  test("an old flush cannot cross a same-ID resume generation", async () => {
    const session = await SessionManager.createNew("same-id-flush-fence");
    created.add(session.id);
    await SessionManager.update({ metadata: { replacement: true } });
    const oldGeneration = SessionManager.captureCurrentSessionMutation()!.generation;

    SessionManager.getCurrentSession()!.metadata = { staleFlush: true };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.metadata?.["staleFlush"] === true) {
          started();
          await gate;
        }
        return writeSnapshot(candidate, guard);
      }
    );
    const staleEvents: unknown[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type !== SessionEvents.Updated.name) return;
      const properties = event.properties as { session?: { metadata?: Record<string, unknown> } };
      if (properties.session?.metadata?.["staleFlush"] === true) staleEvents.push(properties);
    });
    let flushPromise: ReturnType<typeof SessionManager.flushCurrent> | undefined;
    let resumePromise: ReturnType<typeof SessionManager.load> | undefined;

    try {
      flushPromise = SessionManager.flushCurrent();
      await Promise.race([
        didStart,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("flush never reached snapshot persistence")), 100)
        ),
      ]);

      SessionManager.getCurrentSession()!.metadata = { replacement: true };
      resumePromise = SessionManager.load(session.id);
      let resumeSettled = false;
      void resumePromise.finally(() => { resumeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(resumeSettled).toBe(false);
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(oldGeneration);

      release();
      const [flush, resumed] = await Promise.all([flushPromise, resumePromise]);

      expect(flush).toEqual({
        status: "stale",
        sessionID: session.id,
        generation: oldGeneration,
      });
      expect(resumed.metadata).toEqual({ replacement: true });
      expect(SessionManager.getCurrentSession()?.metadata).toEqual({ replacement: true });
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(oldGeneration + 1);
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({ replacement: true });
      expect(staleEvents).toEqual([]);
    } finally {
      release();
      await Promise.all([
        flushPromise?.catch(() => {}),
        resumePromise?.catch(() => {}),
      ]);
      unsubscribe();
      writeSpy.mockRestore();
    }
  });

  test("exit persists a message added during its first flush before clearing current", async () => {
    const session = await SessionManager.createNew("exit-stable-flush");
    created.add(session.id);
    SessionStoreInstance.setSaveDelay(60_000);

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const didStartFirst = new Promise<void>((resolve) => { firstStarted = resolve; });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let secondStarted!: () => void;
    const didStartSecond = new Promise<void>((resolve) => { secondStarted = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    let writes = 0;
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.id === session.id) {
          writes++;
          if (writes === 1) {
            firstStarted();
            await firstGate;
          } else if (writes === 2) {
            secondStarted();
            await secondGate;
          }
        }
        return writeSnapshot(candidate, guard);
      }
    );
    let exitPromise: ReturnType<typeof SessionManager.exitCurrent> | undefined;

    try {
      exitPromise = SessionManager.exitCurrent();
      await didStartFirst;
      await SessionManager.addMessage({
        role: "user",
        content: "must survive lifecycle flush",
        timestamp: new Date().toISOString(),
      });
      releaseFirst();

      const next = await Promise.race([
        didStartSecond.then(() => "stable-retry" as const),
        exitPromise.then(() => "exit-completed" as const),
      ]);
      expect(next).toBe("stable-retry");
      expect(SessionManager.getCurrentSessionID()).toBe(session.id);

      releaseSecond();
      await exitPromise;
      expect(SessionManager.getCurrentSessionID()).toBeNull();
      expect((await SessionStoreInstance.read(session.id)).messages.map((message) => message.content))
        .toEqual(["must survive lifecycle flush"]);
    } finally {
      releaseFirst();
      releaseSecond();
      await exitPromise?.catch(() => {});
      writeSpy.mockRestore();
    }
  });

  test("a flush retries its own promotion when memory changes during the first write", async () => {
    const session = await SessionManager.createNew("flush-preserves-newer-memory");
    created.add(session.id);
    SessionStoreInstance.setSaveDelay(60_000);
    SessionManager.getCurrentSession()!.metadata = { blockedFlush: true };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let secondStarted!: () => void;
    const didStartSecond = new Promise<void>((resolve) => { secondStarted = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.metadata?.["blockedFlush"] === true && candidate.messages.length === 0) {
          started();
          await gate;
        } else if (
          candidate.metadata?.["blockedFlush"] === true &&
          candidate.messages.length === 1
        ) {
          secondStarted();
          await secondGate;
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      const firstFlush = SessionManager.flushCurrent();
      await didStart;
      await SessionManager.addMessage({
        role: "user",
        content: "arrived while flush was promoting",
        timestamp: new Date().toISOString(),
      });

      release();
      await didStartSecond;
      let flushSettled = false;
      void firstFlush.finally(() => { flushSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(flushSettled).toBe(false);
      expect(SessionManager.getCurrentSession()?.messages.map((message) => message.content))
        .toEqual(["arrived while flush was promoting"]);

      releaseSecond();
      await expect(firstFlush).resolves.toMatchObject({
        status: "persisted",
      });
      expect((await SessionStoreInstance.read(session.id)).messages.map((message) => message.content))
        .toEqual(["arrived while flush was promoting"]);
    } finally {
      release();
      releaseSecond();
      writeSpy.mockRestore();
    }
  });

  test("a mutation during the second promotion requires a third stable write", async () => {
    const session = await SessionManager.createNew("flush-third-stable-write");
    created.add(session.id);
    SessionStoreInstance.setSaveDelay(60_000);

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const didStartFirst = new Promise<void>((resolve) => { firstStarted = resolve; });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let secondStarted!: () => void;
    const didStartSecond = new Promise<void>((resolve) => { secondStarted = resolve; });
    let thirdStarted!: () => void;
    const didStartThird = new Promise<void>((resolve) => { thirdStarted = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    let writes = 0;
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.id === session.id) {
          writes++;
          if (writes === 1) {
            firstStarted();
            await firstGate;
          } else if (writes === 2) {
            secondStarted();
            await secondGate;
          } else if (writes === 3) {
            thirdStarted();
          }
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      const flush = SessionManager.flushCurrent();
      await didStartFirst;
      await SessionManager.addMessage({
        role: "user",
        content: "first concurrent message",
        timestamp: new Date().toISOString(),
      });
      releaseFirst();

      await didStartSecond;
      await SessionManager.addMessage({
        role: "user",
        content: "second concurrent message",
        timestamp: new Date().toISOString(),
      });
      releaseSecond();

      await didStartThird;
      await expect(flush).resolves.toMatchObject({ status: "persisted" });
      expect(writes).toBe(3);
      expect((await SessionStoreInstance.read(session.id)).messages.map((message) => message.content))
        .toEqual(["first concurrent message", "second concurrent message"]);
    } finally {
      releaseFirst();
      releaseSecond();
      writeSpy.mockRestore();
    }
  });

  test("side-exchange mutation during lifecycle flush is included in its stable retry", async () => {
    const session = await SessionManager.createNew("side-exchange-stable-flush");
    created.add(session.id);
    SessionStoreInstance.setSaveDelay(60_000);
    await SessionManager.appendSideExchange({
      id: "side-1",
      createdAt: new Date().toISOString(),
      userText: "question",
      assistantText: "answer",
      usedContext: false,
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    let writes = 0;
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.id === session.id) {
          writes++;
          if (writes === 1) {
            started();
            await gate;
          }
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      const exit = SessionManager.exitCurrent();
      await didStart;
      await SessionManager.markSideExchangeCopied("side-1");
      release();
      await exit;

      expect(writes).toBe(2);
      expect((await SessionStoreInstance.read(session.id)).sideExchanges).toEqual([
        expect.objectContaining({ id: "side-1", copiedToMain: true }),
      ]);
    } finally {
      release();
      writeSpy.mockRestore();
    }
  });

  test("a stable flush performs exactly one snapshot write", async () => {
    const session = await SessionManager.createNew("single-stable-write");
    created.add(session.id);
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    let writes = 0;
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.id === session.id) writes++;
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      await expect(SessionManager.flushCurrent()).resolves.toMatchObject({
        status: "persisted",
      });
      expect(writes).toBe(1);
    } finally {
      writeSpy.mockRestore();
    }
  });

  test("continuous same-generation mutation returns dirty and lifecycle exit fails closed", async () => {
    const session = await SessionManager.createNew("bounded-dirty-flush");
    created.add(session.id);
    SessionStoreInstance.setSaveDelay(60_000);
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    let writes = 0;
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.id === session.id) {
          writes++;
          await SessionManager.addMessage({
            role: "user",
            content: `mutation ${writes}`,
            timestamp: new Date().toISOString(),
          });
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      const generation = SessionManager.captureCurrentSessionMutation()!.generation;
      await expect(SessionManager.flushCurrent()).resolves.toEqual({
        status: "dirty",
        sessionID: session.id,
        generation,
        attempts: 3,
      });
      expect(writes).toBe(3);
      expect(SessionManager.getCurrentSession()?.messages).toHaveLength(3);

      await expect(SessionManager.exitCurrent()).rejects.toThrow(
        "Session exit aborted: current session flush remained dirty after 3 attempts"
      );
      expect(writes).toBe(6);
      expect(SessionManager.getCurrentSessionID()).toBe(session.id);
      expect(SessionManager.getCurrentSession()?.messages).toHaveLength(6);
    } finally {
      writeSpy.mockRestore();
    }
  });

  test("flush and update serialize in request order", async () => {
    const session = await SessionManager.createNew("flush-update-order");
    created.add(session.id);
    SessionManager.getCurrentSession()!.metadata = { flushFirst: true };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.metadata?.["flushFirst"] === true && !candidate.headerTitle) {
          started();
          await gate;
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      const flush = SessionManager.flushCurrent();
      await didStart;
      const update = SessionManager.update({ headerTitle: "queued after flush" });
      let updateSettled = false;
      void update.finally(() => { updateSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(updateSettled).toBe(false);

      release();
      await Promise.all([flush, update]);
      expect(SessionManager.getCurrentSession()).toMatchObject({
        headerTitle: "queued after flush",
        metadata: { flushFirst: true },
      });
      expect(await SessionStoreInstance.read(session.id)).toMatchObject({
        headerTitle: "queued after flush",
        metadata: { flushFirst: true },
      });
    } finally {
      release();
      writeSpy.mockRestore();
    }
  });

  test("a flush requested after an update observes the completed update", async () => {
    const session = await SessionManager.createNew("update-flush-order");
    created.add(session.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const update = SessionStoreInstance.update.bind(SessionStoreInstance);
    const updateSpy = spyOn(SessionStoreInstance, "update").mockImplementation(
      async (sessionID, patch, guard) => {
        if (patch.headerTitle === "update before flush") {
          started();
          await gate;
        }
        return update(sessionID, patch, guard);
      }
    );

    try {
      const currentUpdate = SessionManager.update({
        headerTitle: "update before flush",
        metadata: { ordered: true },
      });
      await didStart;
      const flush = SessionManager.flushCurrent();
      let flushSettled = false;
      void flush.finally(() => { flushSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(flushSettled).toBe(false);

      release();
      await Promise.all([currentUpdate, flush]);
      expect(await SessionStoreInstance.read(session.id)).toMatchObject({
        headerTitle: "update before flush",
        metadata: { ordered: true },
      });
    } finally {
      release();
      updateSpy.mockRestore();
    }
  });

  test("flush failure leaves the generation usable and lifecycle exit awaits durability", async () => {
    const session = await SessionManager.createNew("flush-failure-recovery");
    created.add(session.id);
    SessionManager.getCurrentSession()!.metadata = { recoverable: true };
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    let failOnce = true;
    const failureSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (failOnce && candidate.id === session.id) {
          failOnce = false;
          throw new Error("injected flush promotion failure");
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      await expect(SessionManager.flushCurrent()).rejects.toThrow(
        "injected flush promotion failure"
      );
      expect(SessionManager.getCurrentSessionID()).toBe(session.id);
      await expect(SessionManager.flushCurrent()).resolves.toMatchObject({
        status: "persisted",
      });
    } finally {
      failureSpy.mockRestore();
    }

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const exitSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.id === session.id) {
          started();
          await gate;
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      const exit = SessionManager.exitCurrent();
      await didStart;
      let exitSettled = false;
      void exit.finally(() => { exitSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(exitSettled).toBe(false);
      expect(SessionManager.getCurrentSessionID()).toBe(session.id);

      release();
      await exit;
      expect(SessionManager.getCurrentSessionID()).toBeNull();
    } finally {
      release();
      exitSpy.mockRestore();
    }
  });

  test("a flush requested after same-ID replacement targets only the new generation", async () => {
    const session = await SessionManager.createNew("replacement-flush");
    created.add(session.id);
    const firstGeneration = SessionManager.captureCurrentSessionMutation()!.generation;
    await expect(SessionManager.flushCurrent()).resolves.toEqual({
      status: "persisted",
      sessionID: session.id,
      generation: firstGeneration,
    });

    await SessionManager.load(session.id);
    const replacementGeneration = SessionManager.captureCurrentSessionMutation()!.generation;
    expect(replacementGeneration).toBe(firstGeneration + 1);
    await SessionManager.update({ headerTitle: "new-generation flush" });

    await expect(SessionManager.flushCurrent()).resolves.toEqual({
      status: "persisted",
      sessionID: session.id,
      generation: replacementGeneration,
    });
    expect((await SessionStoreInstance.read(session.id)).headerTitle).toBe(
      "new-generation flush"
    );
  });

  test("same-ID replacement refuses to discard content added during activation", async () => {
    const session = await SessionManager.createNew("replacement-content-fence");
    created.add(session.id);
    SessionStoreInstance.setSaveDelay(60_000);
    const generation = SessionManager.captureCurrentSessionMutation()!.generation;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const stageSnapshot = SessionStoreInstance.stageSnapshot.bind(SessionStoreInstance);
    let blockOnce = true;
    const stageSpy = spyOn(SessionStoreInstance, "stageSnapshot").mockImplementation(
      async (candidate) => {
        if (blockOnce && candidate.id === session.id) {
          blockOnce = false;
          started();
          await gate;
        }
        return stageSnapshot(candidate);
      }
    );

    try {
      const resume = SessionManager.load(session.id);
      await didStart;
      await SessionManager.addMessage({
        role: "user",
        content: "arrived during replacement",
        timestamp: new Date().toISOString(),
      });
      release();

      await expect(resume).rejects.toThrow(
        "Same-session replacement content changed during activation"
      );
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(generation);
      expect(SessionManager.getCurrentSession()?.messages.map((message) => message.content))
        .toEqual(["arrived during replacement"]);

      await expect(SessionManager.flushCurrent()).resolves.toMatchObject({
        status: "persisted",
      });
      expect((await SessionStoreInstance.read(session.id)).messages.map((message) => message.content))
        .toEqual(["arrived during replacement"]);
    } finally {
      release();
      stageSpy.mockRestore();
    }
  });

  test("a lifecycle exit refuses a stale flush and leaves the replacement current", async () => {
    const session = await SessionManager.createNew("stale-exit-flush");
    created.add(session.id);
    await SessionManager.update({ metadata: { replacement: true } });
    SessionManager.getCurrentSession()!.metadata = { staleExit: true };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const writeSnapshot = SessionStoreInstance.writeSnapshot.bind(SessionStoreInstance);
    const writeSpy = spyOn(SessionStoreInstance, "writeSnapshot").mockImplementation(
      async (candidate, guard) => {
        if (candidate.metadata?.["staleExit"] === true) {
          started();
          await gate;
        }
        return writeSnapshot(candidate, guard);
      }
    );

    try {
      const exit = SessionManager.exitCurrent();
      await didStart;
      SessionManager.getCurrentSession()!.metadata = { replacement: true };
      const resume = SessionManager.load(session.id);
      release();

      await expect(exit).rejects.toThrow(
        "Session exit aborted: current session flush became stale"
      );
      await expect(resume).resolves.toMatchObject({ metadata: { replacement: true } });
      expect(SessionManager.getCurrentSessionID()).toBe(session.id);
      expect((await SessionStoreInstance.read(session.id)).metadata).toEqual({
        replacement: true,
      });
    } finally {
      release();
      writeSpy.mockRestore();
    }
  });
});
