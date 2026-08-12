import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { restartBgJob } from "../src/tools/bash.js";
import { cleanupAllBgJobs, getBgJob, killBgJob, registerBgJob } from "../src/tools/bg-process-registry.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

describe("restartBgJob", () => {
  beforeEach(async () => enterAgentModeForTest());
  afterEach(async () => {
    await cleanupAllBgJobs();
    setCurrentMode("ASK");
  });

  test("returns ok:false for an unknown job id", async () => {
    const result = await restartBgJob("no-such-job");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no-such-job");
    }
  });

  test("restarts a finished job under a new id, preserving command and cwd", async () => {
    const cwd = process.cwd();
    const { bashTool } = await import("../src/tools/bash.js");
    const { setAllowAllBypass, resetAllowAllBypass } = await import("../src/permission/index.js");
    setAllowAllBypass(true);
    try {
      const startResult = await bashTool.handler({
        command: `bun -e "console.log(1)"`,
        description: "restart test seed job",
        workdir: cwd,
        background: true,
        timeout: 10_000,
      });
      const originalId = startResult.metadata?.["bgJobId"] as string;
      expect(originalId).toBeTruthy();

      // Let the (trivial) command finish.
      await new Promise((r) => setTimeout(r, 500));

      const result = await restartBgJob(originalId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newJobId).not.toBe(originalId);
        const newEntry = getBgJob(result.newJobId);
        expect(newEntry?.command).toBe(`bun -e "console.log(1)"`);
        expect(newEntry?.cwd).toBe(cwd);
        await killBgJob(result.newJobId);
      }
    } finally {
      resetAllowAllBypass();
    }
  }, 15_000);

  test("kills a still-running job before restarting it", async () => {
    let killed = false;
    // Use a real-but-trivial command for the re-spawn side (the original
    // entry's stored kill() is a stub — only entry.id/status are under test
    // here) so the restart doesn't leave a genuine long-running process behind.
    const entry = registerBgJob({
      command: `bun -e "console.log(1)"`,
      cwd: process.cwd(),
      pid: 999999999,
      kill: () => { killed = true; },
    });

    let result;
    try {
      result = await restartBgJob(entry.id);
      expect(killed).toBe(true);
      expect(getBgJob(entry.id)?.status).toBe("killed");
    } finally {
      if (result?.ok) await killBgJob(result.newJobId);
    }
  }, 15_000);
});
