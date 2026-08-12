import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { resetAllowAllBypass, setAllowAllBypass } from "../src/permission/index.js";
import { transitionModeAuthority } from "../src/tools/mode-transition.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { Tool } from "../src/tools/registry.js";
import {
  countForegroundProcesses,
  registerForegroundProcess,
} from "../src/tools/foreground-process-registry.js";
import { cleanupExecutionParticipants } from "../src/tools/execution-revocation.js";
import {
  countStartingExecutionParticipants,
  registerExecutionStart,
} from "../src/tools/execution-admission.js";
import { setPtyRuntimeForTests } from "../src/pty/index.js";
import "../src/tools/bash.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

async function waitUntil(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for foreground append loop");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function reserveSyntheticForeground() {
  const admission = registerExecutionStart("synthetic-foreground", () => {});
  expect(admission.accepted).toBe(true);
  return admission;
}

describe("foreground execution revocation", () => {
  let project: string;

  beforeEach(async () => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-foreground-revoke-"));
    setAllowAllBypass(true);
    await enterAgentModeForTest();
  });

  afterEach(() => {
    expect(countForegroundProcesses()).toBe(0);
    setPtyRuntimeForTests(null);
    resetAllowAllBypass();
    setCurrentMode("ASK");
    fs.rmSync(project, { recursive: true, force: true });
  });

  test("AGENT to ASK confirms a foreground bash process tree stopped before returning", async () => {
    const counterPath = path.join(project, "counter.txt");
    const command = process.platform === "win32"
      ? `$i = 0; while ($i -lt 60) { Add-Content -Path '${counterPath.replaceAll("'", "''")}' -Value x; $i++; Start-Sleep -Milliseconds 20 }`
      : `i=0; while [ $i -lt 60 ]; do printf 'x\\n' >> ${JSON.stringify(counterPath)}; i=$((i+1)); sleep 0.02; done`;
    const execution = Tool.execute("bash", {
      command,
      description: "finite foreground append loop",
      workdir: project,
      timeout: 10_000,
    });
    const count = () => {
      if (!fs.existsSync(counterPath)) return 0;
      return fs.readFileSync(counterPath, "utf-8").trim().split("\n").filter(Boolean).length;
    };

    try {
      await waitUntil(() => count() >= 3);
      const transition = await transitionModeAuthority("AGENT", "ASK");
      expect(transition.changed).toBe(true);
      expect(transition.mode).toBe("ASK");

      const stoppedCount = count();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(count()).toBe(stoppedCount);
    } finally {
      await execution;
    }
  }, 15_000);

  test("lifecycle cleanup owns a foreground bash start before command bytes execute", async () => {
    const outputPath = path.join(project, "late-foreground.txt");
    const command = process.platform === "win32"
      ? `Set-Content -Path '${outputPath.replaceAll("'", "''")}' -Value late; Start-Sleep -Milliseconds 200`
      : `printf 'late\n' > ${JSON.stringify(outputPath)}; sleep 0.2`;

    let executionSettled = false;
    const execution = Tool.execute("bash", {
      command,
      description: "foreground admission race",
      workdir: project,
      timeout: 5_000,
    }).finally(() => { executionSettled = true; });
    expect(countStartingExecutionParticipants()).toBe(1);
    const cleanup = await cleanupExecutionParticipants("new-session");

    expect(cleanup.ok).toBe(true);
    expect(executionSettled).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(false);
    await execution;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(countForegroundProcesses()).toBe(0);
  }, 10_000);

  test("PTY execution transfers its start reservation before lifecycle revocation", async () => {
    setPtyRuntimeForTests({
      execute: async (command, cwd, onEvent, signal) => {
        const proc = Bun.spawn({
          cmd: ["bash", "-lc", command],
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const abort = () => {
          try { proc.kill(); } catch { /* already exited */ }
        };
        signal?.addEventListener("abort", abort, { once: true });
        const output = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve("");
        const result = Promise.all([proc.exited, output]).then(([exitCode, stdout]) => {
          signal?.removeEventListener("abort", abort);
          onEvent({ type: "exit", output: "", exitCode });
          return { output: stdout, exitCode, pid: proc.pid };
        });
        return {
          pid: proc.pid,
          write: () => {},
          kill: abort,
          result,
        };
      },
    });

    const counterPath = path.join(project, "pty-counter.txt");
    const command = process.platform === "win32"
      ? `$i = 0; while ($i -lt 40) { Add-Content -Path '${counterPath.replaceAll("'", "''")}' -Value x; $i++; Start-Sleep -Milliseconds 20 }`
      : `i=0; while [ $i -lt 40 ]; do printf 'x\n' >> ${JSON.stringify(counterPath)}; i=$((i+1)); sleep 0.02; done`;
    const execution = Tool.execute("bash", {
      command,
      description: "tracked PTY append loop",
      workdir: project,
      interactive: true,
      timeout: 10_000,
    });
    const count = () => {
      if (!fs.existsSync(counterPath)) return 0;
      return fs.readFileSync(counterPath, "utf-8").trim().split("\n").filter(Boolean).length;
    };

    try {
      await waitUntil(() => count() >= 2 && countForegroundProcesses() === 1);
      expect(countStartingExecutionParticipants()).toBe(0);

      const cleanup = await cleanupExecutionParticipants("new-session");
      expect(cleanup.ok).toBe(true);
      const stoppedCount = count();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(count()).toBe(stoppedCount);
      expect(countForegroundProcesses()).toBe(0);
    } finally {
      await execution;
    }
  }, 15_000);

  test("ordinary foreground execution binds and releases all ownership", async () => {
    const outputPath = path.join(project, "ordinary.txt");
    const command = process.platform === "win32"
      ? `Set-Content -Path '${outputPath.replaceAll("'", "''")}' -Value ordinary`
      : `printf 'ordinary\n' > ${JSON.stringify(outputPath)}`;

    const result = await Tool.execute("bash", {
      command,
      description: "ordinary foreground execution",
      workdir: project,
      timeout: 5_000,
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toContain("ordinary");
    expect(countStartingExecutionParticipants()).toBe(0);
    expect(countForegroundProcesses()).toBe(0);
  });

  test("foreground execution does not spawn when admission is already closed", async () => {
    const outputPath = path.join(project, "closed-admission.txt");
    expect((await cleanupExecutionParticipants("new-session")).ok).toBe(true);

    const command = process.platform === "win32"
      ? `Set-Content -Path '${outputPath.replaceAll("'", "''")}' -Value denied`
      : `printf 'denied\n' > ${JSON.stringify(outputPath)}`;
    const result = await Tool.execute("bash", {
      command,
      description: "closed foreground admission",
      workdir: project,
      timeout: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("Execution is paused");
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(countStartingExecutionParticipants()).toBe(0);
    expect(countForegroundProcesses()).toBe(0);
  });

  test("PTY spawn failure releases its foreground start reservation", async () => {
    setPtyRuntimeForTests({
      execute: async () => {
        throw new Error("synthetic PTY spawn failure");
      },
    });

    const result = await Tool.execute("bash", {
      command: "ignored",
      description: "PTY spawn error",
      workdir: project,
      interactive: true,
      timeout: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("synthetic PTY spawn failure");
    expect(countStartingExecutionParticipants()).toBe(0);
    expect(countForegroundProcesses()).toBe(0);
    expect((await cleanupExecutionParticipants("new-session")).ok).toBe(true);
  });

  test("a delayed foreground kill keeps the transition pending until exit confirmation", async () => {
    let releaseKill!: () => void;
    const killGate = new Promise<void>((resolve) => { releaseKill = resolve; });
    let confirmExit!: () => void;
    const exited = new Promise<void>((resolve) => { confirmExit = resolve; });
    await registerForegroundProcess({
      kill: async () => {
        await killGate;
        confirmExit();
      },
      exited,
      admission: reserveSyntheticForeground(),
    });

    let settled = false;
    const transition = transitionModeAuthority("AGENT", "ASK").then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    expect(countForegroundProcesses()).toBe(1);

    releaseKill();
    expect(await transition).toMatchObject({ changed: true, mode: "ASK" });
    expect(countForegroundProcesses()).toBe(0);
  });

  test("unconfirmed foreground exit keeps AGENT until exit is eventually observed", async () => {
    let confirmExit!: () => void;
    const exited = new Promise<void>((resolve) => { confirmExit = resolve; });
    const registration = await registerForegroundProcess({
      kill: async () => {
        throw new Error("cannot terminate");
      },
      exited,
      admission: reserveSyntheticForeground(),
    });

    const failed = await transitionModeAuthority("AGENT", "ASK");
    expect(failed.changed).toBe(false);
    expect(failed.mode).toBe("AGENT");
    expect(failed.failedJobIds).toContain(registration.id);
    expect(countForegroundProcesses()).toBe(1);

    confirmExit();
    await exited;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(countForegroundProcesses()).toBe(0);
    expect(await transitionModeAuthority("AGENT", "ASK")).toMatchObject({
      changed: true,
      mode: "ASK",
    });
  }, 5_000);

  test("lifecycle cleanup uses the same confirmed foreground participant", async () => {
    let confirmExit!: () => void;
    const exited = new Promise<void>((resolve) => { confirmExit = resolve; });
    await registerForegroundProcess({
      kill: () => confirmExit(),
      exited,
      admission: reserveSyntheticForeground(),
    });

    expect(await cleanupExecutionParticipants("new-session")).toEqual({
      ok: true,
      context: "new-session",
      stoppedJobs: 0,
      stoppedShells: 0,
      failedParticipantIds: [],
      notice: null,
    });
    expect(countForegroundProcesses()).toBe(0);
  });

  test("ASK rejection awaits foreground termination instead of firing and forgetting", async () => {
    setCurrentMode("ASK");
    let killCalls = 0;
    let releaseKill!: () => void;
    const killGate = new Promise<void>((resolve) => { releaseKill = resolve; });
    let confirmExit!: () => void;
    const exited = new Promise<void>((resolve) => { confirmExit = resolve; });
    const admission = registerExecutionStart("rejected-foreground", () => {});
    let settled = false;
    const registration = Promise.resolve(registerForegroundProcess({
      kill: async () => {
        killCalls++;
        await killGate;
        confirmExit();
      },
      exited,
      admission,
    })).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();

    expect(admission.accepted).toBe(false);
    expect(killCalls).toBe(1);
    expect(settled).toBe(false);
    releaseKill();
    expect((await registration).accepted).toBe(false);
    expect(countForegroundProcesses()).toBe(0);
  });
});
