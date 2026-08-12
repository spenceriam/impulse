import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Bus } from "../src/bus";
import {
  BgJobEvents,
  appendBgOutput,
  cleanupAllBgJobs,
  cleanupAllBgJobsSync,
  countRunningBgJobs,
  drainBgNotifications,
  getBgJob,
  killBgJob,
  listBgJobs,
  markBgJobDone,
  registerBgJob,
} from "../src/tools/bg-process-registry.js";
import { killProcessTree } from "../src/util/process-tree.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import { enterAgentModeForTest } from "./helpers/authority.js";

describe("bg-process-registry lifecycle", () => {
  beforeEach(async () => {
    await cleanupAllBgJobs();
    await enterAgentModeForTest();
  });

  afterEach(async () => {
    await cleanupAllBgJobs();
    setCurrentMode("ASK");
  });

  test("killBgJob waits for process exit before reporting killed", async () => {
    const proc = Bun.spawn({
      cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      stdout: "ignore",
      stderr: "ignore",
    });
    let killCalls = 0;
    const job = registerBgJob({
      command: "long-running process",
      cwd: "/tmp",
      pid: proc.pid,
      kill: async () => {
        killCalls++;
        await killProcessTree(proc.pid);
      },
    });

    try {
      const result = killBgJob(job.id);
      const duplicate = killBgJob(job.id);
      expect(getBgJob(job.id)?.status).toBe("stopping");
      expect(await Promise.all([result, duplicate])).toEqual([true, true]);
      expect(killCalls).toBe(1);
      expect(getBgJob(job.id)?.status).toBe("killed");
      expect(() => process.kill(proc.pid, 0)).toThrow();
    } finally {
      await killProcessTree(proc.pid);
    }
  }, 10_000);

  test("markBgJobDone does not overwrite a killed job's status or queue a notification", async () => {
    const job = registerBgJob({
      command: "sleep 100",
      cwd: "/tmp",
      pid: 999999999,
      kill: () => {},
    });
    await killBgJob(job.id);
    drainBgNotifications(); // clear whatever the kill itself may have queued

    markBgJobDone(job.id, 0);

    expect(getBgJob(job.id)?.status).toBe("killed");
    expect(drainBgNotifications()).toEqual([]);
  });

  test("markBgJobDone on a still-running job sets done/failed and queues a notification when idle", () => {
    const job = registerBgJob({ command: "echo hi", cwd: "/tmp", kill: () => {} });
    drainBgNotifications();

    markBgJobDone(job.id, 0);
    expect(getBgJob(job.id)?.status).toBe("done");
    expect(drainBgNotifications().some((n) => n.includes(job.id))).toBe(true);

    const job2 = registerBgJob({ command: "false", cwd: "/tmp", kill: () => {} });
    drainBgNotifications();
    markBgJobDone(job2.id, 1);
    expect(getBgJob(job2.id)?.status).toBe("failed");
  });

  test("cleanupAllBgJobs kills only active jobs and empties the registry after confirmation", async () => {
    let killedRunning = false;
    let killedDone = false;
    const running = registerBgJob({
      command: "sleep 100",
      cwd: "/tmp",
      pid: 999999999,
      kill: () => { killedRunning = true; },
    });
    const done = registerBgJob({ command: "echo hi", cwd: "/tmp", kill: () => { killedDone = true; } });
    markBgJobDone(done.id, 0);

    const result = await cleanupAllBgJobs();

    expect(result.failedJobIds).toEqual([]);
    expect(killedRunning).toBe(true);
    expect(killedDone).toBe(false); // already finished; no need to kill it
    expect(listBgJobs()).toEqual([]);
    expect(getBgJob(running.id)).toBeUndefined();
    expect(drainBgNotifications()).toEqual([]);
  });

  test("cleanupAllBgJobs awaits the kill callback and confirmed PID exit", async () => {
    let killed = false;
    const job = registerBgJob({
      command: "sleep 100",
      cwd: "/tmp",
      pid: 999999999, // guaranteed-invalid pid so the sync tree reap is a safe no-op
      kill: () => { killed = true; },
    });

    expect((await cleanupAllBgJobs()).failedJobIds).toEqual([]);

    expect(killed).toBe(true);
    expect(getBgJob(job.id)).toBeUndefined();
  });

  test("cleanupAllBgJobsSync swallows a throwing kill without throwing itself", async () => {
    const job = registerBgJob({
      command: "sleep 100",
      cwd: "/tmp",
      pid: 999999999, // guaranteed-invalid pid so any real kill attempt errors
      kill: () => {
        throw new Error("boom");
      },
    });

    expect(() => cleanupAllBgJobsSync()).not.toThrow();
    markBgJobDone(job.id, -1);
    await cleanupAllBgJobs();
  });

  test("publishes bg-job.changed on register, done, stopping, and confirmed kill", async () => {
    const events: Array<{ id: string; status: string }> = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === BgJobEvents.Changed.name) {
        events.push(event.properties as { id: string; status: string });
      }
    });

    const job = registerBgJob({ command: "echo hi", cwd: "/tmp", kill: () => {} });
    markBgJobDone(job.id, 0);

    const job2 = registerBgJob({
      command: "sleep 100",
      cwd: "/tmp",
      pid: 999999999,
      kill: () => {},
    });
    await killBgJob(job2.id);

    unsubscribe();

    expect(events).toContainEqual({ id: job.id, status: "running" });
    expect(events).toContainEqual({ id: job.id, status: "done" });
    expect(events).toContainEqual({ id: job2.id, status: "stopping" });
    expect(events).toContainEqual({ id: job2.id, status: "killed" });
  });

  test("appendBgOutput on an unknown id is a no-op", () => {
    expect(() => appendBgOutput("no-such-job", "text")).not.toThrow();
  });

  test("countRunningBgJobs includes active running or stopping jobs", async () => {
    await cleanupAllBgJobs();
    registerBgJob({ command: "sleep 100", cwd: "/tmp", pid: 999999999, kill: () => {} });
    const finished = registerBgJob({ command: "echo hi", cwd: "/tmp", kill: () => {} });
    markBgJobDone(finished.id, 0);

    expect(countRunningBgJobs()).toBe(1);
    await cleanupAllBgJobs();
  });

  test("ASK rejects direct background registration without tracking a running job", async () => {
    setCurrentMode("ASK");
    let killCalls = 0;
    const rejected = registerBgJob({
      command: "must not start",
      cwd: "/tmp",
      kill: () => { killCalls++; },
    });
    await Promise.resolve();

    expect(rejected.admitted).toBe(false);
    expect(killCalls).toBe(1);
    expect(getBgJob(rejected.id)).toBeUndefined();
    expect(countRunningBgJobs()).toBe(0);
  });
});
