import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  isGoalLoopExecutable,
  runGoalLoopActionIfExecutable,
} from "../src/agent/goal-loop.js";
import { countActiveGoalLoopExecutions } from "../src/agent/goal-execution.js";
import { hydrateGoalFromSession, writeGoalArtifact, appendGoalProgress } from "../src/goal/artifact.js";
import { getGoalDir } from "../src/goal/paths.js";
import { createGoalState } from "../src/session/goal-state.js";
import { cleanupExecutionParticipants } from "../src/tools/execution-revocation.js";
import { getCurrentMode, setCurrentMode } from "../src/tools/mode-state.js";
import { transitionModeAuthority } from "../src/tools/mode-transition.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

describe("goal loop authority", () => {
  let project: string;
  const sessionId = "goal-loop-authority-session";

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-goal-loop-authority-"));
    setCurrentMode("ASK");
  });

  afterEach(async () => {
    await cleanupExecutionParticipants("tui-stop");
    expect(countActiveGoalLoopExecutions()).toBe(0);
    setCurrentMode("ASK");
    fs.rmSync(project, { recursive: true, force: true });
  });

  test("hydrated active goals are view-only in ASK and executable only while AGENT", async () => {
    const activeGoal = createGoalState("Continue only with execution authority");
    const hydration = hydrateGoalFromSession({
      sessionId,
      metadataGoal: activeGoal,
      mode: "ASK",
      source: "session-hydration",
      cwd: project,
    });
    expect(hydration.state).toEqual(activeGoal);
    expect(await hydration.migration).toBe(false);
    expect(isGoalLoopExecutable("ASK", true, hydration.state)).toBe(false);

    let judgeCalls = 0;
    let continuationLaunches = 0;
    const executeAfterTurn = async () => {
      judgeCalls++;
      appendGoalProgress(
        sessionId,
        {
          turn: 1,
          verdict: "continue",
          reason: "more work remains",
          timestamp: "2026-08-10T12:00:00.000Z",
        },
        project
      );
      await writeGoalArtifact(sessionId, activeGoal, project);
      continuationLaunches++;
    };

    const ask = await runGoalLoopActionIfExecutable({
      mode: "ASK",
      experimentalGoalEnabled: true,
      state: hydration.state,
      action: executeAfterTurn,
    });
    expect(ask.executed).toBe(false);
    expect(judgeCalls).toBe(0);
    expect(continuationLaunches).toBe(0);
    expect(fs.existsSync(getGoalDir(sessionId, project))).toBe(false);

    await enterAgentModeForTest();
    const agent = await runGoalLoopActionIfExecutable({
      mode: "AGENT",
      experimentalGoalEnabled: true,
      state: hydration.state,
      action: executeAfterTurn,
    });
    expect(agent.executed).toBe(true);
    expect(judgeCalls).toBe(1);
    expect(continuationLaunches).toBe(1);
    expect(fs.existsSync(path.join(getGoalDir(sessionId, project), "progress.md"))).toBe(true);
    expect(fs.existsSync(path.join(getGoalDir(sessionId, project), "state.json"))).toBe(true);

    setCurrentMode("ASK");
    const downgraded = await runGoalLoopActionIfExecutable({
      mode: "ASK",
      experimentalGoalEnabled: true,
      state: hydration.state,
      action: executeAfterTurn,
    });
    expect(downgraded.executed).toBe(false);
    expect(judgeCalls).toBe(1);
    expect(continuationLaunches).toBe(1);
  });

  test("AGENT to ASK cancels and awaits delayed autonomous goal work before result handling", async () => {
    const activeGoal = createGoalState("Do not persist after authority is revoked");
    await enterAgentModeForTest();

    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    let actionStarted = false;
    let handledJudgeResult = false;
    let autonomousRelaunches = 0;
    const action = runGoalLoopActionIfExecutable({
      mode: "AGENT",
      experimentalGoalEnabled: true,
      state: activeGoal,
      action: async () => {
        actionStarted = true;
        await actionGate;
        return "continue";
      },
    }).then(async (result) => {
      if (result.executed) {
        handledJudgeResult = true;
        appendGoalProgress(
          sessionId,
          {
            turn: 1,
            verdict: "continue",
            reason: "late judge result",
            timestamp: "2026-08-10T12:00:00.000Z",
          },
          project
        );
        await writeGoalArtifact(sessionId, activeGoal, project);
        autonomousRelaunches++;
      }
      return result;
    });

    while (!actionStarted) await new Promise((resolve) => setTimeout(resolve, 1));

    let transitionSettled = false;
    const transition = transitionModeAuthority("AGENT", "ASK").then((result) => {
      transitionSettled = true;
      if (result.changed) setCurrentMode(result.mode);
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(transitionSettled).toBe(false);

    releaseAction();
    expect(await transition).toMatchObject({ changed: true, mode: "ASK" });
    expect((await action).executed).toBe(false);
    expect(handledJudgeResult).toBe(false);
    expect(autonomousRelaunches).toBe(0);
    expect(fs.existsSync(getGoalDir(sessionId, project))).toBe(false);
  });

  test("lifecycle cleanup awaits delayed autonomous goal work", async () => {
    const activeGoal = createGoalState("Stop before lifecycle teardown");
    await enterAgentModeForTest();

    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    let actionStarted = false;
    const action = runGoalLoopActionIfExecutable({
      mode: "AGENT",
      experimentalGoalEnabled: true,
      state: activeGoal,
      action: async () => {
        actionStarted = true;
        await actionGate;
      },
    });
    while (!actionStarted) await new Promise((resolve) => setTimeout(resolve, 1));

    let cleanupSettled = false;
    const cleanup = cleanupExecutionParticipants("exit").then((result) => {
      cleanupSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cleanupSettled).toBe(false);

    releaseAction();
    expect(await cleanup).toMatchObject({ ok: true, failedParticipantIds: [] });
    expect((await action).executed).toBe(false);
  });

  test("revocation guards delayed goal persistence and autonomous relaunch boundaries", async () => {
    const activeGoal = createGoalState("Guard every autonomous mutation boundary");
    await enterAgentModeForTest();

    let releaseActions!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseActions = resolve;
    });
    let persistenceStarted = false;
    let relaunchStarted = false;
    let relaunches = 0;

    const persistence = runGoalLoopActionIfExecutable({
      mode: "AGENT",
      experimentalGoalEnabled: true,
      state: activeGoal,
      action: async (signal) => {
        persistenceStarted = true;
        await actionGate;
        if (signal.aborted) return;
        await writeGoalArtifact(sessionId, activeGoal, project);
      },
    });
    const relaunch = runGoalLoopActionIfExecutable({
      mode: "AGENT",
      experimentalGoalEnabled: true,
      state: activeGoal,
      action: async (signal) => {
        relaunchStarted = true;
        await actionGate;
        if (signal.aborted) return;
        relaunches++;
      },
    });
    while (!persistenceStarted || !relaunchStarted) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    let transitionSettled = false;
    const transition = transitionModeAuthority("AGENT", "ASK").then((result) => {
      transitionSettled = true;
      if (result.changed) setCurrentMode(result.mode);
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(transitionSettled).toBe(false);

    releaseActions();
    expect(await transition).toMatchObject({ changed: true, mode: "ASK" });
    expect((await persistence).executed).toBe(false);
    expect((await relaunch).executed).toBe(false);
    expect(relaunches).toBe(0);
    expect(fs.existsSync(getGoalDir(sessionId, project))).toBe(false);
  });

  test("an unconfirmed autonomous goal cancellation fails closed in AGENT", async () => {
    const activeGoal = createGoalState("Remain AGENT until cancellation is confirmed");
    await enterAgentModeForTest();

    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    let actionStarted = false;
    const action = runGoalLoopActionIfExecutable({
      mode: "AGENT",
      experimentalGoalEnabled: true,
      state: activeGoal,
      action: async () => {
        actionStarted = true;
        await actionGate;
      },
    });
    while (!actionStarted) await new Promise((resolve) => setTimeout(resolve, 1));

    const failed = await transitionModeAuthority("AGENT", "ASK");
    if (failed.changed) setCurrentMode(failed.mode);
    expect(failed).toMatchObject({ changed: false, mode: "AGENT" });
    expect(failed.failedJobIds[0]).toStartWith("goal-loop-");
    expect(getCurrentMode()).toBe("AGENT");

    releaseAction();
    expect((await action).executed).toBe(false);

    const confirmed = await transitionModeAuthority("AGENT", "ASK");
    expect(confirmed).toMatchObject({ changed: true, mode: "ASK" });
  });

  test("goal-owned de-escalation defers ASK until goal work unregisters", async () => {
    const activeGoal = createGoalState("De-escalate without deadlock");
    await enterAgentModeForTest();
    let resultHandled = false;

    const action = await runGoalLoopActionIfExecutable({
      mode: "AGENT",
      experimentalGoalEnabled: true,
      state: activeGoal,
      action: async (signal) => {
        const transition = await transitionModeAuthority("AGENT", "ASK", {
          source: "model",
        });
        expect(transition).toMatchObject({
          changed: false,
          mode: "AGENT",
          requestedMode: "ASK",
          pending: true,
        });
        expect(getCurrentMode()).toBe("AGENT");
        expect(signal.aborted).toBe(true);
        return "late";
      },
    });
    if (action.executed) resultHandled = true;

    expect(action.executed).toBe(false);
    expect(resultHandled).toBe(false);
    const deadline = Date.now() + 1_000;
    while (getCurrentMode() !== "ASK") {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for goal de-escalation");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(countActiveGoalLoopExecutions()).toBe(0);
  });
});
