import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  countActiveAgentTurnExecutions,
  canContinueAgentExecution,
  registerAgentTurnExecution,
} from "../src/session/turn-execution.js";
import { transitionModeAuthority } from "../src/tools/mode-transition.js";
import { cleanupExecutionParticipants } from "../src/tools/execution-revocation.js";
import {
  getExecutionAdmissionState,
} from "../src/tools/execution-admission.js";
import {
  countActiveGoalLoopExecutions,
  registerGoalLoopExecution,
} from "../src/agent/goal-execution.js";
import { getCurrentMode, setCurrentMode } from "../src/tools/mode-state.js";
import { Bus, ModeEvents } from "../src/bus/index.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

describe("agent execution revocation", () => {
  beforeEach(async () => {
    await enterAgentModeForTest();
  });

  afterEach(() => {
    expect(countActiveAgentTurnExecutions()).toBe(0);
    expect(countActiveGoalLoopExecutions()).toBe(0);
    setCurrentMode("ASK");
  });

  test("AGENT to ASK waits for the post-tool boundary and no next mutation starts", async () => {
    const controller = new AbortController();
    const registration = registerAgentTurnExecution(() => controller.abort());
    let firstToolFinished = false;
    let secondMutatingToolStarted = false;

    const execution = (async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 120));
        firstToolFinished = true;
        if (canContinueAgentExecution(controller.signal)) {
          secondMutatingToolStarted = true;
        }
      } finally {
        registration.complete();
      }
    })();

    let transitionSettled = false;
    const transition = transitionModeAuthority("AGENT", "ASK").then((result) => {
      transitionSettled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(controller.signal.aborted).toBe(true);
    expect(transitionSettled).toBe(false);
    expect(firstToolFinished).toBe(false);

    await execution;
    expect(await transition).toMatchObject({ changed: true, mode: "ASK" });
    expect(secondMutatingToolStarted).toBe(false);
  });

  test("model de-escalation stays pending until its active turn unregisters", async () => {
    const controller = new AbortController();
    const registration = registerAgentTurnExecution(() => controller.abort());
    const changes: string[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === ModeEvents.Changed.name) {
        changes.push((event.properties as { mode: string }).mode);
      }
    });

    try {
      const transition = await transitionModeAuthority("AGENT", "ASK", { source: "model" });
      expect(transition).toMatchObject({
        changed: false,
        mode: "AGENT",
        requestedMode: "ASK",
        pending: true,
      });
      expect(controller.signal.aborted).toBe(true);
      expect(countActiveAgentTurnExecutions()).toBe(1);
      expect(getCurrentMode()).toBe("AGENT");
      expect(changes).toEqual([]);

      registration.complete();
      const deadline = Date.now() + 1_000;
      while (getCurrentMode() !== "ASK") {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for deferred ASK commit");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(countActiveAgentTurnExecutions()).toBe(0);
      expect(changes).toEqual(["ASK"]);
    } finally {
      registration.complete();
      unsubscribe();
    }
  });

  test("failed deferred model de-escalation keeps AGENT and reports the failure", async () => {
    const initiatingController = new AbortController();
    const initiating = registerAgentTurnExecution(() => initiatingController.abort());
    const blocker = registerAgentTurnExecution(() => {});
    const failures: Array<{
      mode: string;
      requestedMode: string;
      failedParticipantIds: string[];
      stoppedJobs: number;
      stoppedShells: number;
    }> = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === ModeEvents.TransitionFailed.name) {
        failures.push(event.properties as typeof failures[number]);
      }
    });

    try {
      const transition = await transitionModeAuthority("AGENT", "ASK", { source: "model" });
      expect(transition).toMatchObject({ pending: true, mode: "AGENT" });
      expect(initiatingController.signal.aborted).toBe(true);
      initiating.complete();

      const deadline = Date.now() + 2_500;
      while (failures.length === 0) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for de-escalation failure");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(getCurrentMode()).toBe("AGENT");
      expect(failures).toEqual([{
        mode: "AGENT",
        requestedMode: "ASK",
        failedParticipantIds: [blocker.id],
        stoppedJobs: 0,
        stoppedShells: 0,
      }]);
      const resumed = registerAgentTurnExecution(() => {});
      expect(resumed.accepted).toBe(true);
      resumed.complete();
    } finally {
      initiating.complete();
      blocker.complete();
      unsubscribe();
    }
  }, 5_000);

  test("duplicate model de-escalation requests share one pending transition", async () => {
    const controller = new AbortController();
    const registration = registerAgentTurnExecution(() => controller.abort());
    const changes: string[] = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === ModeEvents.Changed.name) {
        changes.push((event.properties as { mode: string }).mode);
      }
    });

    try {
      const first = await transitionModeAuthority("AGENT", "ASK", { source: "model" });
      const duplicate = await transitionModeAuthority("AGENT", "ASK", { source: "model" });

      expect(first).toMatchObject({ pending: true, mode: "AGENT" });
      expect(duplicate).toMatchObject({
        pending: true,
        duplicate: true,
        mode: "AGENT",
      });
      expect(controller.signal.aborted).toBe(true);
      expect(changes).toEqual([]);

      registration.complete();
      const deadline = Date.now() + 1_000;
      while (changes.length === 0) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for shared transition");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(changes).toEqual(["ASK"]);
      expect(countActiveAgentTurnExecutions()).toBe(0);
    } finally {
      registration.complete();
      unsubscribe();
    }
  });

  test("lifecycle cleanup also waits for the active agent turn boundary", async () => {
    let registration!: ReturnType<typeof registerAgentTurnExecution>;
    registration = registerAgentTurnExecution(() => {
      setTimeout(() => registration.complete(), 100);
    });

    let settled = false;
    const cleanup = cleanupExecutionParticipants("exit").then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    expect(await cleanup).toEqual({
      ok: true,
      context: "exit",
      stoppedJobs: 0,
      stoppedShells: 0,
      failedParticipantIds: [],
      notice: null,
    });
  });

  test("cleanup cannot succeed while an abort callback registers a replacement turn", async () => {
    let replacement: ReturnType<typeof registerAgentTurnExecution> | undefined;
    let original!: ReturnType<typeof registerAgentTurnExecution>;
    original = registerAgentTurnExecution(() => {
      replacement = registerAgentTurnExecution(() => {});
      original.complete();
    });

    const cleanup = await cleanupExecutionParticipants("new-session");
    const activeAfterSuccess = countActiveAgentTurnExecutions();

    try {
      expect(cleanup.ok).toBe(true);
      expect(activeAfterSuccess).toBe(0);
    } finally {
      replacement?.complete();
    }
  });

  test("cleanup closes cross-registry goal work started by a turn abort callback", async () => {
    let replacement: ReturnType<typeof registerGoalLoopExecution> | undefined;
    let original!: ReturnType<typeof registerAgentTurnExecution>;
    original = registerAgentTurnExecution(() => {
      replacement = registerGoalLoopExecution();
      original.complete();
    });

    const cleanup = await cleanupExecutionParticipants("new-session");
    const activeAfterSuccess = countActiveGoalLoopExecutions();

    try {
      expect(cleanup.ok).toBe(true);
      expect(activeAfterSuccess).toBe(0);
      expect(replacement?.signal.aborted).toBe(true);
    } finally {
      replacement?.complete();
    }
  });

  test("concurrent lifecycle cleanups share one closed cancellation phase", async () => {
    let abortCalls = 0;
    let registration!: ReturnType<typeof registerAgentTurnExecution>;
    registration = registerAgentTurnExecution(() => {
      abortCalls++;
      setTimeout(() => registration.complete(), 80);
    });

    const first = cleanupExecutionParticipants("new-session");
    const second = cleanupExecutionParticipants("exit");
    const [newSession, exit] = await Promise.all([first, second]);

    expect(abortCalls).toBe(1);
    expect(newSession).toMatchObject({ ok: true, context: "new-session" });
    expect(exit).toMatchObject({ ok: true, context: "exit" });
    expect(countActiveAgentTurnExecutions()).toBe(0);
    expect(getExecutionAdmissionState()).toBe("closed");
  });

  test("failed cleanup reopens AGENT admission, while successful ASK transfer stays closed", async () => {
    const unconfirmed = registerAgentTurnExecution(() => {});
    const failed = await cleanupExecutionParticipants("new-session");
    expect(failed.ok).toBe(false);
    expect(getExecutionAdmissionState()).toBe("open");

    const resumedAgentTurn = registerAgentTurnExecution(() => {});
    expect(resumedAgentTurn.accepted).toBe(true);
    resumedAgentTurn.complete();
    unconfirmed.complete();

    const downgrade = await transitionModeAuthority("AGENT", "ASK");
    expect(downgrade).toMatchObject({ changed: true, mode: "ASK" });
    setCurrentMode("ASK");
    const blockedInAsk = registerAgentTurnExecution(() => {});
    expect(blockedInAsk.accepted).toBe(false);
    expect(countActiveAgentTurnExecutions()).toBe(0);
    const readOnlyAskTurn = registerAgentTurnExecution(
      () => {},
      { mutating: false }
    );
    expect(readOnlyAskTurn.accepted).toBe(true);
    readOnlyAskTurn.complete();

    const elevation = await transitionModeAuthority("ASK", "AGENT");
    expect(elevation).toMatchObject({ changed: true, mode: "AGENT" });
    await enterAgentModeForTest();
    const admittedAfterExplicitAgent = registerAgentTurnExecution(() => {});
    expect(admittedAfterExplicitAgent.accepted).toBe(true);
    admittedAfterExplicitAgent.complete();
  });

  test("an explicit AGENT request cannot cross an active lifecycle close boundary", async () => {
    setCurrentMode("ASK");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let readOnlyTurn!: ReturnType<typeof registerAgentTurnExecution>;
    readOnlyTurn = registerAgentTurnExecution(
      () => { void gate.then(() => readOnlyTurn.complete()); },
      { mutating: false }
    );
    expect(readOnlyTurn.accepted).toBe(true);

    const cleanup = cleanupExecutionParticipants("update");
    await Promise.resolve();
    expect(getExecutionAdmissionState()).toBe("closing");
    expect(await transitionModeAuthority("ASK", "AGENT")).toMatchObject({
      changed: false,
      mode: "ASK",
      failedJobIds: ["execution-admission"],
    });

    release();
    expect(await cleanup).toMatchObject({ ok: true, context: "update" });
    expect(getExecutionAdmissionState()).toBe("closed");
  });
});
