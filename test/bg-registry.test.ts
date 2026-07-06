import { describe, expect, test } from "bun:test";
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

describe("bg-process-registry lifecycle", () => {
  test("killBgJob marks the job killed and calls its kill callback", () => {
    let killed = false;
    const job = registerBgJob({ command: "sleep 100", cwd: "/tmp", kill: () => { killed = true; } });

    const ok = killBgJob(job.id);

    expect(ok).toBe(true);
    expect(killed).toBe(true);
    expect(getBgJob(job.id)?.status).toBe("killed");
  });

  test("markBgJobDone does not overwrite a killed job's status or queue a notification", () => {
    const job = registerBgJob({ command: "sleep 100", cwd: "/tmp", kill: () => {} });
    killBgJob(job.id);
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

  test("cleanupAllBgJobs kills only running jobs and empties the registry and notification queue", () => {
    let killedRunning = false;
    let killedDone = false;
    const running = registerBgJob({ command: "sleep 100", cwd: "/tmp", kill: () => { killedRunning = true; } });
    const done = registerBgJob({ command: "echo hi", cwd: "/tmp", kill: () => { killedDone = true; } });
    markBgJobDone(done.id, 0);

    cleanupAllBgJobs();

    expect(killedRunning).toBe(true);
    expect(killedDone).toBe(false); // already finished; no need to kill it
    expect(listBgJobs()).toEqual([]);
    expect(getBgJob(running.id)).toBeUndefined();
    expect(drainBgNotifications()).toEqual([]);
  });

  test("cleanupAllBgJobsSync swallows a throwing kill without throwing itself", () => {
    registerBgJob({
      command: "sleep 100",
      cwd: "/tmp",
      pid: 999999999, // guaranteed-invalid pid so any real kill attempt errors
      kill: () => {
        throw new Error("boom");
      },
    });

    expect(() => cleanupAllBgJobsSync()).not.toThrow();
  });

  test("publishes bg-job.changed on register, done, and kill", () => {
    const events: Array<{ id: string; status: string }> = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === BgJobEvents.Changed.name) {
        events.push(event.properties as { id: string; status: string });
      }
    });

    const job = registerBgJob({ command: "echo hi", cwd: "/tmp", kill: () => {} });
    markBgJobDone(job.id, 0);

    const job2 = registerBgJob({ command: "sleep 100", cwd: "/tmp", kill: () => {} });
    killBgJob(job2.id);

    unsubscribe();

    expect(events).toContainEqual({ id: job.id, status: "running" });
    expect(events).toContainEqual({ id: job.id, status: "done" });
    expect(events).toContainEqual({ id: job2.id, status: "killed" });
  });

  test("appendBgOutput on an unknown id is a no-op", () => {
    expect(() => appendBgOutput("no-such-job", "text")).not.toThrow();
  });

  test("countRunningBgJobs reflects only running jobs", () => {
    cleanupAllBgJobs();
    registerBgJob({ command: "sleep 100", cwd: "/tmp", kill: () => {} });
    const finished = registerBgJob({ command: "echo hi", cwd: "/tmp", kill: () => {} });
    markBgJobDone(finished.id, 0);

    expect(countRunningBgJobs()).toBe(1);
    cleanupAllBgJobs();
  });
});
