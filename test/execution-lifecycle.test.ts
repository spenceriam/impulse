import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  cleanupAllBgJobs,
  countRunningBgJobs,
  getBgJob,
  registerBgJob,
} from "../src/tools/bg-process-registry.js";
import {
  cleanupExecutionParticipants,
  executionCleanupFailureNotice,
} from "../src/tools/execution-revocation.js";
import {
  abortUserShell,
  isUserShellActive,
  runUserShellCommand,
} from "../src/cli/user-shell.js";
import { killProcessTree } from "../src/util/process-tree.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

async function waitUntil(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for lifecycle append loop");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("execution lifecycle cleanup", () => {
  let project: string;

  beforeEach(async () => {
    await abortUserShell();
    await cleanupAllBgJobs();
    await enterAgentModeForTest();
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-lifecycle-cleanup-"));
  });

  afterEach(async () => {
    await abortUserShell();
    await cleanupAllBgJobs();
    setCurrentMode("ASK");
    fs.rmSync(project, { recursive: true, force: true });
  });

  test("new-session cleanup confirms every active participant stopped before success", async () => {
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
    const bgJob = registerBgJob({
      command: "lifecycle append loop",
      cwd: project,
      pid: bgProc.pid,
      kill: () => killProcessTree(bgProc.pid),
    });
    const lineCount = (filePath: string) => {
      if (!fs.existsSync(filePath)) return 0;
      return fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean).length;
    };

    try {
      await waitUntil(() => lineCount(shellCounter) >= 3 && lineCount(bgCounter) >= 3);
      let cleanupSettled = false;
      const cleanup = cleanupExecutionParticipants("new-session").then((result) => {
        cleanupSettled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(cleanupSettled).toBe(false);
      const result = await cleanup;

      expect(result).toEqual({
        ok: true,
        context: "new-session",
        stoppedJobs: 1,
        stoppedShells: 1,
        failedParticipantIds: [],
        notice: null,
      });
      expect(isUserShellActive()).toBe(false);
      expect(countRunningBgJobs()).toBe(0);
      expect(getBgJob(bgJob.id)).toBeUndefined();

      const stoppedShellCount = lineCount(shellCounter);
      const stoppedBgCount = lineCount(bgCounter);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(lineCount(shellCounter)).toBe(stoppedShellCount);
      expect(lineCount(bgCounter)).toBe(stoppedBgCount);
    } finally {
      await abortUserShell();
      await shellRun;
      await killProcessTree(bgProc.pid);
    }
  }, 15_000);

  test("lifecycle cleanup with no participants is simple", async () => {
    expect(await cleanupExecutionParticipants("update")).toEqual({
      ok: true,
      context: "update",
      stoppedJobs: 0,
      stoppedShells: 0,
      failedParticipantIds: [],
      notice: null,
    });
  });

  test("ASK rejects a user-shell start before spawning a participant", async () => {
    setCurrentMode("ASK");
    let error: unknown;
    try {
      await runUserShellCommand({ command: "echo should-not-run", onData: () => {} });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Execution is paused");
    expect(isUserShellActive()).toBe(false);
  });

  test("unconfirmed shell cleanup fails closed with contextual lifecycle notices", async () => {
    const counterPath = path.join(project, "unconfirmed-shell.txt");
    const command = process.platform === "win32"
      ? `while ($true) { Add-Content -Path '${counterPath.replaceAll("'", "''")}' -Value x; Start-Sleep -Milliseconds 20 }`
      : `while true; do printf 'x\\n' >> ${JSON.stringify(counterPath)}; sleep 0.02; done`;
    const shellRun = runUserShellCommand({ command, onData: () => {} });
    await waitUntil(() => fs.existsSync(counterPath));

    const originalKill = process.kill;
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) return true;
      return originalKill.call(process, pid, signal);
    }) as typeof process.kill;

    try {
      expect(await cleanupExecutionParticipants("exit")).toEqual({
        ok: false,
        context: "exit",
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: ["user-shell"],
        notice: "Exit blocked -- failed to stop user-shell; Impulse remains running",
      });
    } finally {
      process.kill = originalKill;
    }

    await shellRun;
    expect(isUserShellActive()).toBe(false);
    expect(executionCleanupFailureNotice("new-session", ["user-shell"])).toBe(
      "New session blocked -- failed to stop user-shell"
    );
    expect(executionCleanupFailureNotice("resume", ["user-shell"])).toBe(
      "Resume blocked -- failed to stop user-shell"
    );
    expect(executionCleanupFailureNotice("update", ["user-shell"])).toBe(
      "Update relaunch blocked -- failed to stop user-shell"
    );
    expect(executionCleanupFailureNotice("tui-stop", ["user-shell"])).toBe(
      "Action blocked -- failed to stop user-shell"
    );
  }, 10_000);
});
