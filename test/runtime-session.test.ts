import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  HeadlessRuntime,
  type RuntimeHistoryBinding,
  type RuntimeTurnDriver,
  type RuntimeTurnDriverContext,
} from "../src/runtime/session.js";
import type { ExecutionBoundary } from "../src/execution/boundary.js";
import { registerExecutionStart } from "../src/tools/execution-admission.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("headless runtime session seam", () => {
  test("interleaved sessions isolate authority, config, history, boundary, and cancellation", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-b-")));
    const releaseA = deferred();
    const releaseB = deferred();
    const observed = new Map<string, RuntimeTurnDriverContext>();

    const driver: RuntimeTurnDriver = {
      async run(context) {
        observed.set(context.session.id, context);
        context.emit({ type: "assistant-token", text: `reply:${context.prompt.text}` });
        await (context.session.cwd === rootA ? releaseA.promise : releaseB.promise);
        if (context.signal.aborted) return { stopReason: "cancelled" };
        return {
          stopReason: "end-turn",
          usage: { inputTokens: 4, outputTokens: 2, contextTokens: 6, contextWindow: 100 },
        };
      },
    };

    const runtime = new HeadlessRuntime({ turnDriver: driver });
    const sessionA = runtime.createSession({ cwd: rootA });
    const sessionB = runtime.createSession({ cwd: rootB });
    sessionA.setMode("AGENT");
    sessionA.setConfig("density", "comfy");
    sessionB.setConfig("approvalPolicy", "allow-all");

    const turnA = sessionA.run({ text: "alpha", content: [{ type: "text", text: "alpha" }] });
    const turnB = sessionB.run({ text: "beta", content: [{ type: "text", text: "beta" }] });
    for (let i = 0; i < 10 && observed.size < 2; i++) await Promise.resolve();

    expect(observed.size).toBe(2);
    expect(observed.get(sessionA.id)?.session).toMatchObject({
      cwd: rootA,
      mode: "AGENT",
      config: { density: "comfy", approvalPolicy: "prompt" },
    });
    expect(observed.get(sessionB.id)?.session).toMatchObject({
      cwd: rootB,
      mode: "ASK",
      config: { density: "compact", approvalPolicy: "allow-all" },
    });
    expect(observed.get(sessionA.id)?.signal).not.toBe(observed.get(sessionB.id)?.signal);

    const cancelledA = sessionA.cancel();
    releaseA.resolve();
    releaseB.resolve();

    expect(await cancelledA).toBe(true);
    expect(await turnA).toEqual({ stopReason: "cancelled" });
    expect(await turnB).toMatchObject({ stopReason: "end-turn" });
    expect(sessionA.snapshot().history).toEqual([
      { role: "user", content: "alpha" },
      { role: "assistant", content: "reply:alpha" },
    ]);
    expect(sessionB.snapshot().history).toEqual([
      { role: "user", content: "beta" },
      { role: "assistant", content: "reply:beta" },
    ]);
    expect(sessionA.snapshot().turnActive).toBe(false);
    expect(sessionB.snapshot().turnActive).toBe(false);
  });

  test("permissions, questions, plans, and tool events remain session-owned", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-perm-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-perm-b-")));
    const driver: RuntimeTurnDriver = {
      async run(context) {
        context.emit({
          type: "tool-start",
          id: "write-1",
          name: "file_write",
          title: "Write result",
          kind: "edit",
          locations: [{ path: join(context.session.cwd, "result.txt") }],
          rawInput: { path: "result.txt" },
        });
        const permission = await context.requestPermission({
          toolCallId: "write-1",
          title: "Write result",
          kind: "edit",
          options: [
            { id: "allow", label: "Allow", kind: "allow-once" },
            { id: "reject", label: "Reject", kind: "reject-once" },
          ],
        });
        const answer = await context.requestQuestion({
          prompt: "Which format?",
          choices: [{ id: "text", label: "Text" }],
        });
        context.emit({
          type: "plan",
          id: "plan-1",
          entries: [{ id: "step-1", content: "Write result", priority: "high", status: "completed" }],
        });
        context.emit({
          type: "tool-end",
          id: "write-1",
          name: "file_write",
          success: permission.outcome === "selected",
          output: answer.outcome === "answered" ? answer.values.join(",") : "cancelled",
          durationMs: 5,
        });
        return { stopReason: "end-turn" };
      },
    };
    const runtime = new HeadlessRuntime({ turnDriver: driver });
    const sessionA = runtime.createSession({ cwd: rootA });
    const sessionB = runtime.createSession({ cwd: rootB, config: { approvalPolicy: "allow-all" } });
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    sessionA.onEvent((event) => {
      eventsA.push(event.type);
      if (event.type === "permission-request") {
        expect(sessionB.respondPermission(event.request.id, { outcome: "selected", optionId: "allow" })).toBe(false);
        expect(sessionA.respondPermission(event.request.id, { outcome: "selected", optionId: "allow" })).toBe(true);
      }
      if (event.type === "question") {
        expect(sessionA.respondQuestion(event.request.id, { outcome: "answered", values: ["text"] })).toBe(true);
      }
    });
    sessionB.onEvent((event) => {
      eventsB.push(event.type);
      if (event.type === "question") {
        expect(sessionB.respondQuestion(event.request.id, { outcome: "answered", values: ["text"] })).toBe(true);
      }
    });

    await Promise.all([
      sessionA.run({ text: "write A", content: [{ type: "text", text: "write A" }] }),
      sessionB.run({ text: "write B", content: [{ type: "text", text: "write B" }] }),
    ]);

    expect(eventsA).toContain("permission-request");
    expect(eventsA).toContain("permission-outcome");
    expect(eventsB).not.toContain("permission-request");
    expect(eventsB).toContain("permission-outcome");
    expect(eventsA.filter((type) => type === "tool-start")).toHaveLength(1);
    expect(eventsB.filter((type) => type === "tool-end")).toHaveLength(1);
    expect(eventsA).toContain("question");
    expect(eventsB).toContain("plan");
    expect(sessionB.snapshot().boundary.label).toBe("HOST");
  });

  test("loads and flushes the session history binding without dropping streamed chunks", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-history-")));
    const appended: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> = [];
    let closed = false;
    const history: RuntimeHistoryBinding = {
      async load() {
        return [{ role: "system", content: "bound history" }];
      },
      async append(message) {
        await Promise.resolve();
        appended.push({ ...message });
      },
      async close() {
        closed = true;
      },
    };
    const runtime = new HeadlessRuntime({
      turnDriver: {
        async run(context) {
          context.emit({ type: "assistant-token", text: "hello " });
          context.emit({ type: "assistant-token", text: "world" });
          return { stopReason: "end-turn" };
        },
      },
    });
    const session = runtime.createSession({ cwd: root, history });

    await session.run({ text: "continue", content: [{ type: "text", text: "continue" }] });
    expect(session.snapshot().history).toEqual([
      { role: "system", content: "bound history" },
      { role: "user", content: "continue" },
      { role: "assistant", content: "hello world" },
    ]);
    expect(appended).toEqual([
      { role: "user", content: "continue" },
      { role: "assistant", content: "hello " },
      { role: "assistant", content: "world" },
    ]);
    await runtime.closeSession(session.id);
    expect(closed).toBe(true);
  });

  test("keeps launch allow-all authoritative and cancellation settles pending interactions", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-override-")));
    let observedPermission: unknown;
    const permissionStarted = deferred();
    const driver: RuntimeTurnDriver = {
      async run(context) {
        observedPermission = await context.requestPermission({
          toolCallId: "write-override",
          title: "Write",
          kind: "edit",
          options: [
            { id: "allow", label: "Allow", kind: "allow-once" },
            { id: "reject", label: "Reject", kind: "reject-once" },
          ],
        });
        return { stopReason: "end-turn" };
      },
    };
    const runtime = new HeadlessRuntime({ turnDriver: driver, launchApprovalPolicy: "allow-all" });
    const bypassed = runtime.createSession({ cwd: root, config: { approvalPolicy: "prompt" } });
    const bypassEvents: string[] = [];
    bypassed.onEvent((event) => {
      bypassEvents.push(event.type);
      if (event.type === "permission-request") {
        bypassed.respondPermission(event.request.id, { outcome: "selected", optionId: "allow" });
      }
    });
    bypassed.setConfig("approvalPolicy", "prompt");
    await bypassed.run({ text: "bypass", content: [{ type: "text", text: "bypass" }] });
    expect(bypassed.snapshot().config.approvalPolicy).toBe("allow-all");
    expect(bypassEvents).not.toContain("permission-request");
    expect(observedPermission).toEqual({ outcome: "selected", optionId: "allow" });

    const promptedRuntime = new HeadlessRuntime({ turnDriver: driver });
    const prompted = promptedRuntime.createSession({ cwd: root });
    let requestId = "";
    prompted.onEvent((event) => {
      if (event.type === "permission-request") {
        requestId = event.request.id;
        permissionStarted.resolve();
      }
    });
    const turn = prompted.run({ text: "cancel", content: [{ type: "text", text: "cancel" }] });
    await permissionStarted.promise;
    setTimeout(() => {
      prompted.respondPermission(requestId, { outcome: "selected", optionId: "reject" });
    }, 25);
    expect(await prompted.cancel()).toBe(true);
    expect(await turn).toEqual({ stopReason: "cancelled" });
    expect(observedPermission).toEqual({ outcome: "cancelled" });
    expect(prompted.snapshot().pendingPermissionIds).toEqual([]);

    await Promise.all([runtime.dispose(), promptedRuntime.dispose()]);
  });

  test("retains ownership and retries only failed teardown participants", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-close-retry-")));
    let boundaryCalls = 0;
    let driverCloseCalls = 0;
    let historyCloseCalls = 0;
    let resourceCloseCalls = 0;
    const boundary: ExecutionBoundary = {
      descriptor: {
        kind: "host",
        label: "HOST",
        workspaceRoot: root,
        backend: "host",
        network: "host",
      },
      async resolvePath(input) { return join(root, input); },
      async run() { return { exitCode: 0, stdout: "", stderr: "" }; },
      async cleanup() {
        boundaryCalls++;
        return boundaryCalls === 1
          ? { ok: false, stopped: 0, reason: "injected boundary failure" }
          : { ok: true, stopped: 0 };
      },
    };
    const history: RuntimeHistoryBinding = {
      async load() { return []; },
      async append() {},
      async close() { historyCloseCalls++; },
    };
    const runtime = new HeadlessRuntime({
      turnDriver: {
        async run() { return { stopReason: "end-turn" }; },
        async closeSession() { driverCloseCalls++; },
      },
    });
    const session = runtime.createSession({
      cwd: root,
      boundary,
      history,
      resources: [{
        id: "fixture-resource",
        async close() { resourceCloseCalls++; },
      }],
    });

    await expect(runtime.closeSession(session.id)).rejects.toThrow("injected boundary failure");
    expect(runtime.getSession(session.id)).toBe(session);
    expect(session.snapshot().closed).toBe(false);
    expect({ boundaryCalls, driverCloseCalls, historyCloseCalls, resourceCloseCalls }).toEqual({
      boundaryCalls: 1,
      driverCloseCalls: 1,
      historyCloseCalls: 1,
      resourceCloseCalls: 1,
    });

    expect(await runtime.closeSession(session.id)).toBe(true);
    expect(runtime.getSession(session.id)).toBeUndefined();
    expect(session.snapshot().closed).toBe(true);
    expect({ boundaryCalls, driverCloseCalls, historyCloseCalls, resourceCloseCalls }).toEqual({
      boundaryCalls: 2,
      driverCloseCalls: 1,
      historyCloseCalls: 1,
      resourceCloseCalls: 1,
    });
  });

  test("dispose retains permanently failed sessions and surfaces cleanup failure", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-dispose-fail-")));
    let driverDisposed = 0;
    const runtime = new HeadlessRuntime({
      turnDriver: {
        async run() { return { stopReason: "end-turn" }; },
        async dispose() { driverDisposed++; },
      },
    });
    const session = runtime.createSession({
      cwd: root,
      resources: [{
        id: "permanent-failure",
        async close() { throw new Error("permanent cleanup failure"); },
      }],
    });

    await expect(runtime.dispose()).rejects.toThrow("permanent cleanup failure");
    expect(runtime.getSession(session.id)).toBe(session);
    expect(driverDisposed).toBe(1);
    await expect(runtime.dispose()).rejects.toThrow("permanent cleanup failure");
    expect(runtime.getSession(session.id)).toBe(session);
    expect(driverDisposed).toBe(1);
  });

  test("awaits session-local AGENT to ASK revocation before reporting reduced authority", async () => {
    const rootA = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-revoke-a-")));
    const rootB = await realpath(await mkdtemp(join(tmpdir(), "impulse-runtime-revoke-b-")));
    const startedA = deferred();
    const startedB = deferred();
    const abortedA = deferred();
    const releaseA = deferred();
    const releaseB = deferred();
    let lateAAdmission: boolean | undefined;
    let bAdmission: boolean | undefined;
    const driver: RuntimeTurnDriver = {
      async run(context) {
        if (context.session.cwd === rootA) {
          startedA.resolve();
          await new Promise<void>((resolve) => {
            if (context.signal.aborted) resolve();
            else context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          abortedA.resolve();
          await releaseA.promise;
          const late = registerExecutionStart("late-a", () => {}, { mutating: true });
          lateAAdmission = late.accepted;
          late.complete();
          return { stopReason: "cancelled" };
        }
        startedB.resolve();
        const admitted = registerExecutionStart("live-b", () => {}, { mutating: true });
        bAdmission = admitted.accepted;
        await releaseB.promise;
        admitted.complete();
        return { stopReason: "end-turn" };
      },
    };
    const runtime = new HeadlessRuntime({ turnDriver: driver });
    const sessionA = runtime.createSession({ cwd: rootA, mode: "AGENT" });
    const sessionB = runtime.createSession({ cwd: rootB, mode: "AGENT" });
    const turnA = sessionA.run({ text: "alpha", content: [{ type: "text", text: "alpha" }] });
    const turnB = sessionB.run({ text: "beta", content: [{ type: "text", text: "beta" }] });
    await Promise.all([startedA.promise, startedB.promise]);

    let transitionSettled = false;
    const transition = sessionA.transitionMode("ASK").then(() => { transitionSettled = true; });
    await abortedA.promise;
    expect(transitionSettled).toBe(false);
    expect(sessionA.snapshot().mode).toBe("AGENT");
    expect(sessionB.snapshot().mode).toBe("AGENT");
    expect(bAdmission).toBe(true);

    releaseA.resolve();
    await transition;
    expect(await turnA).toEqual({ stopReason: "cancelled" });
    expect(lateAAdmission).toBe(false);
    expect(sessionA.snapshot().mode).toBe("ASK");
    expect(sessionB.snapshot().mode).toBe("AGENT");
    expect(sessionB.snapshot().turnActive).toBe(true);

    releaseB.resolve();
    expect(await turnB).toEqual({ stopReason: "end-turn" });
    await runtime.dispose();
  });
});
