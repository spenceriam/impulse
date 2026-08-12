import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { transitionModeAuthority } from "../src/tools/mode-transition.js";
import {
  cleanupAllBgJobs,
  countRunningBgJobs,
  getBgJob,
  killBgJob,
  markBgJobDone,
  registerBgJob,
} from "../src/tools/bg-process-registry.js";
import { killProcessTree } from "../src/util/process-tree.js";
import {
  abortUserShell,
  isUserShellActive,
  runUserShellCommand,
} from "../src/cli/user-shell.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

async function waitUntil(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for background append loop");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("mode background-job revocation", () => {
  let project: string;

  beforeEach(async () => {
    await abortUserShell();
    await cleanupAllBgJobs();
    await enterAgentModeForTest();
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-mode-revoke-"));
  });

  afterEach(async () => {
    await abortUserShell();
    await cleanupAllBgJobs();
    setCurrentMode("ASK");
    fs.rmSync(project, { recursive: true, force: true });
  });

  test("AGENT to ASK stops a tracked append loop before returning ASK", async () => {
    const counterPath = path.join(project, "counter.txt");
    const script =
      `const fs=require("fs");` +
      `setInterval(()=>fs.appendFileSync(${JSON.stringify(counterPath)},"x\\n"),20);`;
    const proc = Bun.spawn({
      cmd: [process.execPath, "-e", script],
      cwd: project,
      stdout: "ignore",
      stderr: "ignore",
    });
    const job = registerBgJob({
      command: "append loop",
      cwd: project,
      pid: proc.pid,
      kill: () => killProcessTree(proc.pid),
    });

    const count = () => {
      if (!fs.existsSync(counterPath)) return 0;
      return fs.readFileSync(counterPath, "utf-8").trim().split("\n").filter(Boolean).length;
    };
    await waitUntil(() => count() >= 3);

    const result = await transitionModeAuthority("AGENT", "ASK");
    expect(result).toEqual({
      changed: true,
      mode: "ASK",
      stoppedJobs: 1,
      failedJobIds: [],
    });
    expect(getBgJob(job.id)?.status).toBe("killed");
    expect(countRunningBgJobs()).toBe(0);
    const stoppedCount = count();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(count()).toBe(stoppedCount);
  }, 10_000);

  test("AGENT to ASK stops an active user-shell append loop before returning ASK", async () => {
    const counterPath = path.join(project, "user-shell-counter.txt");
    const command = process.platform === "win32"
      ? `while ($true) { Add-Content -Path '${counterPath.replaceAll("'", "''")}' -Value x; Start-Sleep -Milliseconds 20 }`
      : `while true; do printf 'x\\n' >> ${JSON.stringify(counterPath)}; sleep 0.02; done`;
    const shellRun = runUserShellCommand({
      command,
      onData: () => {},
    });
    const count = () => {
      if (!fs.existsSync(counterPath)) return 0;
      return fs.readFileSync(counterPath, "utf-8").trim().split("\n").filter(Boolean).length;
    };

    try {
      await waitUntil(() => count() >= 3);
      expect(isUserShellActive()).toBe(true);
      let transitionSettled = false;
      const transition = transitionModeAuthority("AGENT", "ASK").then((result) => {
        transitionSettled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(transitionSettled).toBe(false);

      const result = await transition;
      expect(result.changed).toBe(true);
      expect(result.mode).toBe("ASK");
      expect(result.stoppedShells).toBe(1);
      expect(isUserShellActive()).toBe(false);

      const stoppedCount = count();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(count()).toBe(stoppedCount);
    } finally {
      await abortUserShell();
      await shellRun;
    }
  }, 10_000);

  test("unconfirmed user-shell exit keeps AGENT until confirmation becomes available", async () => {
    const counterPath = path.join(project, "unconfirmed-user-shell.txt");
    const command = process.platform === "win32"
      ? `while ($true) { Add-Content -Path '${counterPath.replaceAll("'", "''")}' -Value x; Start-Sleep -Milliseconds 20 }`
      : `while true; do printf 'x\\n' >> ${JSON.stringify(counterPath)}; sleep 0.02; done`;
    const shellRun = runUserShellCommand({ command, onData: () => {} });
    const count = () => {
      if (!fs.existsSync(counterPath)) return 0;
      return fs.readFileSync(counterPath, "utf-8").trim().split("\n").filter(Boolean).length;
    };
    await waitUntil(() => count() >= 3);

    const originalKill = process.kill;
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) return true;
      return originalKill.call(process, pid, signal);
    }) as typeof process.kill;

    try {
      expect(await transitionModeAuthority("AGENT", "ASK")).toEqual({
        changed: false,
        mode: "AGENT",
        stoppedJobs: 0,
        failedJobIds: ["user-shell"],
      });
    } finally {
      process.kill = originalKill;
    }

    await shellRun;
    expect(isUserShellActive()).toBe(false);
    expect(await transitionModeAuthority("AGENT", "ASK")).toEqual({
      changed: true,
      mode: "ASK",
      stoppedJobs: 0,
      failedJobIds: [],
    });
  }, 10_000);

  test("a delayed explicit kill cannot let AGENT to ASK skip a live tracked job", async () => {
    const counterPath = path.join(project, "delayed-counter.txt");
    const script =
      `const fs=require("fs");` +
      `setInterval(()=>fs.appendFileSync(${JSON.stringify(counterPath)},"x\\n"),20);`;
    const proc = Bun.spawn({
      cmd: [process.execPath, "-e", script],
      cwd: project,
      stdout: "ignore",
      stderr: "ignore",
    });
    let releaseKill!: () => void;
    const killGate = new Promise<void>((resolve) => { releaseKill = resolve; });
    let killCalls = 0;
    const job = registerBgJob({
      command: "delayed append loop",
      cwd: project,
      pid: proc.pid,
      kill: async () => {
        killCalls++;
        await killGate;
        await killProcessTree(proc.pid);
      },
    });
    const count = () => {
      if (!fs.existsSync(counterPath)) return 0;
      return fs.readFileSync(counterPath, "utf-8").trim().split("\n").filter(Boolean).length;
    };
    await waitUntil(() => count() >= 3);

    const killResult = Promise.resolve(killBgJob(job.id));
    expect(getBgJob(job.id)?.status).toBe("stopping");

    let transitionSettled = false;
    const transition = transitionModeAuthority("AGENT", "ASK").then((result) => {
      transitionSettled = true;
      return result;
    });
    const countBeforeWait = count();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(transitionSettled).toBe(false);
    expect(count()).toBeGreaterThan(countBeforeWait);
    expect(killCalls).toBe(1);

    releaseKill();
    expect(await killResult).toBe(true);
    expect(await transition).toEqual({
      changed: true,
      mode: "ASK",
      stoppedJobs: 1,
      failedJobIds: [],
    });
    expect(getBgJob(job.id)?.status).toBe("killed");
    expect(killCalls).toBe(1);
  }, 10_000);

  test("AGENT to ASK with no running jobs is a simple transition", async () => {
    expect(await transitionModeAuthority("AGENT", "ASK")).toEqual({
      changed: true,
      mode: "ASK",
      stoppedJobs: 0,
      failedJobIds: [],
    });
  });

  test("failed termination keeps AGENT until a later observed process exit", async () => {
    let killAttempts = 0;
    const job = registerBgJob({
      command: "unconfirmed job",
      cwd: project,
      kill: async () => {
        killAttempts++;
        throw new Error("cannot terminate");
      },
    });

    expect(await killBgJob(job.id)).toBe(false);
    expect(getBgJob(job.id)?.status).toBe("running");

    const result = await transitionModeAuthority("AGENT", "ASK");
    expect(result).toEqual({
      changed: false,
      mode: "AGENT",
      stoppedJobs: 0,
      failedJobIds: [job.id],
    });
    expect(getBgJob(job.id)?.status).toBe("running");
    expect(countRunningBgJobs()).toBe(1);
    expect(killAttempts).toBe(2);

    markBgJobDone(job.id, 0);
    expect(await transitionModeAuthority("AGENT", "ASK")).toEqual({
      changed: true,
      mode: "ASK",
      stoppedJobs: 0,
      failedJobIds: [],
    });
  });
});
