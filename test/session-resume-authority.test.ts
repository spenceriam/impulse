import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import type { Session } from "../src/session/store.js";
import { resumeSessionWithAuthority } from "../src/session/resume-authority.js";
import { transitionModeAuthority } from "../src/tools/mode-transition.js";
import {
  cleanupAllBgJobs,
  countRunningBgJobs,
  markBgJobDone,
  registerBgJob,
} from "../src/tools/bg-process-registry.js";
import {
  abortUserShell,
  isUserShellActive,
  runUserShellCommand,
} from "../src/cli/user-shell.js";
import { killProcessTree } from "../src/util/process-tree.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { registerAgentTurnExecution } from "../src/session/turn-execution.js";
import {
  countForegroundProcesses,
  registerForegroundProcess,
} from "../src/tools/foreground-process-registry.js";
import { registerExecutionStart } from "../src/tools/execution-admission.js";
import {
  countActiveGoalLoopExecutions,
  registerGoalLoopExecution,
} from "../src/agent/goal-execution.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

async function waitUntil(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for resume append loop");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function sessionAt(directory: string, id: string, mode: string): Session {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    projectID: "temporary-project",
    directory,
    created_at: now,
    updated_at: now,
    messages: [],
    mode,
    model: "test/model",
    todos: [],
    context_window: 100_000,
    cost: 0,
    metadata: {},
  };
}

describe("session resume authority", () => {
  let project: string;

  beforeEach(async () => {
    await abortUserShell();
    await cleanupAllBgJobs();
    await enterAgentModeForTest();
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-resume-authority-"));
  });

  afterEach(async () => {
    await abortUserShell();
    await cleanupAllBgJobs();
    setCurrentMode("ASK");
    fs.rmSync(project, { recursive: true, force: true });
  });

  test("AGENT resume to ASK waits for every execution participant before commit", async () => {
    const shellCounter = path.join(project, "shell-counter.txt");
    const shellCommand = process.platform === "win32"
      ? `while ($true) { Add-Content -Path '${shellCounter.replaceAll("'", "''")}' -Value x; Start-Sleep -Milliseconds 20 }`
      : `while true; do printf 'x\\n' >> ${JSON.stringify(shellCounter)}; sleep 0.02; done`;
    const shellRun = runUserShellCommand({ command: shellCommand, onData: () => {} });

    const bgCounter = path.join(project, "bg-counter.txt");
    const bgScript =
      `const fs=require("fs");` +
      `setInterval(()=>fs.appendFileSync(${JSON.stringify(bgCounter)},"x\\n"),20);`;
    const bgProc = Bun.spawn({
      cmd: [process.execPath, "-e", bgScript],
      cwd: project,
      stdout: "ignore",
      stderr: "ignore",
    });
    registerBgJob({
      command: "resume append loop",
      cwd: project,
      pid: bgProc.pid,
      kill: () => killProcessTree(bgProc.pid),
    });

    let confirmForegroundExit!: () => void;
    const foregroundExited = new Promise<void>((resolve) => {
      confirmForegroundExit = resolve;
    });
    const foregroundAdmission = registerExecutionStart("resume-foreground", () => {});
    const foreground = await registerForegroundProcess({
      kill: async () => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        confirmForegroundExit();
      },
      exited: foregroundExited,
      admission: foregroundAdmission,
    });
    expect(foreground.accepted).toBe(true);

    const goal = registerGoalLoopExecution();
    goal.signal.addEventListener("abort", () => {
      setTimeout(() => goal.complete(), 75);
    }, { once: true });
    expect(goal.accepted).toBe(true);

    const target = sessionAt(project, "stored-ask", "PLAN");
    let committed: Session | null = null;
    const lineCount = (filePath: string) => {
      if (!fs.existsSync(filePath)) return 0;
      return fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean).length;
    };

    try {
      await waitUntil(() => lineCount(shellCounter) >= 3 && lineCount(bgCounter) >= 3);
      let settled = false;
      const resume = resumeSessionWithAuthority({
        currentMode: "AGENT",
        inspect: async () => target,
        commit: async () => {
          committed = target;
          return target;
        },
      }).then((result) => {
        settled = true;
        return result;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      expect(committed).toBeNull();

      const result = await resume;
      expect(result.ok).toBe(true);
      expect(result.mode).toBe("ASK");
      expect(result.storedMode).toBe("ASK");
      expect(result.stoppedJobs).toBe(1);
      expect(result.stoppedShells).toBe(1);
      expect(committed?.id).toBe(target.id);
      expect(countRunningBgJobs()).toBe(0);
      expect(isUserShellActive()).toBe(false);
      expect(countForegroundProcesses()).toBe(0);
      expect(countActiveGoalLoopExecutions()).toBe(0);

      const stoppedShellCount = lineCount(shellCounter);
      const stoppedBgCount = lineCount(bgCounter);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(lineCount(shellCounter)).toBe(stoppedShellCount);
      expect(lineCount(bgCounter)).toBe(stoppedBgCount);
    } finally {
      goal.complete();
      confirmForegroundExit();
      await abortUserShell();
      await shellRun;
      await killProcessTree(bgProc.pid);
    }
  }, 15_000);

  test("failed same-authority resume leaves the current session untouched", async () => {
    const target = sessionAt(project, "blocked-agent", "AGENT");
    let currentSessionId = "current-agent";
    let commitCalls = 0;
    const job = registerBgJob({
      command: "unconfirmed resume participant",
      cwd: project,
      kill: async () => {
        throw new Error("cannot terminate");
      },
    });

    const result = await resumeSessionWithAuthority({
      currentMode: "AGENT",
      inspect: async () => target,
      commit: async () => {
        commitCalls++;
        currentSessionId = target.id;
        return target;
      },
    });

    expect(result.ok).toBe(false);
    expect(result.mode).toBe("AGENT");
    expect(result.notice).toContain("Resume blocked");
    expect(result.notice).toContain(job.id);
    expect(commitCalls).toBe(0);
    expect(currentSessionId).toBe("current-agent");

    markBgJobDone(job.id, 0);
  });

  test("stored AGENT history resumes under current ASK until a later explicit switch", async () => {
    const target = sessionAt(project, "stored-agent", "WORK");
    let commitCalls = 0;
    const result = await resumeSessionWithAuthority({
      currentMode: "ASK",
      inspect: async () => target,
      commit: async () => {
        commitCalls++;
        return target;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("ASK");
    expect(result.storedMode).toBe("AGENT");
    expect(result.notice).toBe(
      "Session restored in ASK -- stored AGENT authority was not resumed. Use /mode AGENT or Tab to switch explicitly."
    );
    expect(commitCalls).toBe(1);

    expect(await transitionModeAuthority(result.mode, "AGENT")).toEqual({
      changed: true,
      mode: "AGENT",
      stoppedJobs: 0,
      failedJobIds: [],
    });
  });

  test("same-authority resume commits without an authority notice", async () => {
    const target = sessionAt(project, "same-ask", "ASK");
    const result = await resumeSessionWithAuthority({
      currentMode: "ASK",
      inspect: async () => target,
      commit: async () => target,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("ASK");
    expect(result.notice).toBeNull();
    expect(result.stoppedJobs).toBe(0);
    expect(result.stoppedShells).toBe(0);
  });

  test("same-authority AGENT resume waits for an active turn before commit", async () => {
    const target = sessionAt(project, "same-agent", "AGENT");
    let currentSessionId = "current-agent";
    let commitCalls = 0;
    let aborted = false;
    let turn!: ReturnType<typeof registerAgentTurnExecution>;
    turn = registerAgentTurnExecution(() => {
      aborted = true;
      setTimeout(() => turn.complete(), 100);
    });
    expect(turn.accepted).toBe(true);

    let settled = false;
    const resume = resumeSessionWithAuthority({
      currentMode: "AGENT",
      inspect: async () => target,
      commit: async () => {
        commitCalls++;
        currentSessionId = target.id;
        return target;
      },
    }).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(aborted).toBe(true);
    expect(settled).toBe(false);
    expect(commitCalls).toBe(0);
    expect(currentSessionId).toBe("current-agent");

    const result = await resume;
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("AGENT");
    expect(commitCalls).toBe(1);
    expect(currentSessionId).toBe(target.id);
  });

  test("same-authority ASK resume waits for a read-only turn before commit", async () => {
    setCurrentMode("ASK");
    const target = sessionAt(project, "same-ask-active", "ASK");
    let commitCalls = 0;
    let turn!: ReturnType<typeof registerAgentTurnExecution>;
    turn = registerAgentTurnExecution(
      () => setTimeout(() => turn.complete(), 100),
      { mutating: false }
    );
    expect(turn.accepted).toBe(true);

    let settled = false;
    const resume = resumeSessionWithAuthority({
      currentMode: "ASK",
      inspect: async () => target,
      commit: async () => {
        commitCalls++;
        return target;
      },
    }).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false);
    expect(commitCalls).toBe(0);

    const result = await resume;
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("ASK");
    expect(commitCalls).toBe(1);

    const nextReadOnlyTurn = registerAgentTurnExecution(() => {}, { mutating: false });
    expect(nextReadOnlyTurn.accepted).toBe(true);
    nextReadOnlyTurn.complete();
  });
});
