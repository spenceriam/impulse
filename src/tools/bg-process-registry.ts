/**
 * Background process registry — tracks non-blocking bash jobs (#116).
 *
 * A job is created when `bash` is called with `background: true`.
 * Output is buffered in a fixed-size ring buffer (MAX_RING_LINES lines).
 * When a job exits, a notification is queued and drained into the conversation
 * at the next flushTurnInjections call (turn end or between tool-loop iterations).
 */

import { z } from "zod";
import { Bus } from "../bus";
import { BusEvent } from "../bus/bus";
import { killProcessTree, killProcessTreeSync } from "../util/process-tree.js";
import {
  isExecutionRegistrationAdmitted,
  type ExecutionStartRegistration,
} from "./execution-admission.js";

/** Fires whenever a job's status changes — lets the UI redraw the `ba` count on demand, no polling. */
export const BgJobEvents = {
  Changed: BusEvent.define("bg-job.changed", z.object({ id: z.string(), status: z.string() })),
};

export type BgJobStatus = "running" | "stopping" | "done" | "killed" | "failed";

export interface BgJob {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  status: BgJobStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
  kill(): void | Promise<void>;
  admitted?: boolean;
}

interface BgJobEntry extends BgJob {
  ringBuffer: string[];
  terminationPromise?: Promise<boolean>;
}

const MAX_RING_LINES = 2000;
const MAX_JOBS = 50;

const registry = new Map<string, BgJobEntry>();
let jobCounter = 0;

/** Pending exit notifications queued while no agent turn was active. */
const pendingBgNotifications: string[] = [];

export function drainBgNotifications(): string[] {
  return pendingBgNotifications.splice(0);
}

function trimOldJobs(): void {
  if (registry.size <= MAX_JOBS) return;
  const done = [...registry.entries()].filter(([, j]) => !isBgJobActive(j));
  done.sort((a, b) => (a[1].startedAt ?? 0) - (b[1].startedAt ?? 0));
  for (const [id] of done.slice(0, registry.size - MAX_JOBS)) {
    registry.delete(id);
  }
}

export function registerBgJob(opts: {
  command: string;
  cwd: string;
  pid?: number;
  kill(): void | Promise<void>;
  admission?: ExecutionStartRegistration;
}): BgJobEntry {
  trimOldJobs();
  const id = `bg-${++jobCounter}`;
  const entry: BgJobEntry = {
    id,
    command: opts.command,
    cwd: opts.cwd,
    pid: opts.pid,
    status: "running",
    startedAt: Date.now(),
    ringBuffer: [],
    kill: opts.kill,
    admitted: isExecutionRegistrationAdmitted(opts.admission),
  };
  if (!entry.admitted) {
    entry.status = "failed";
    entry.endedAt = Date.now();
    try {
      void Promise.resolve(opts.kill()).catch(() => {});
    } catch {
      // Rejected registration remains untracked even when best-effort kill throws.
    }
    return entry;
  }
  registry.set(id, entry);
  Bus.publish(BgJobEvents.Changed, { id, status: entry.status });
  return entry;
}

export function appendBgOutput(id: string, text: string): void {
  const entry = registry.get(id);
  if (!entry) return;
  const lines = text.split("\n");
  for (const line of lines) {
    entry.ringBuffer.push(line);
    if (entry.ringBuffer.length > MAX_RING_LINES) {
      entry.ringBuffer.shift();
    }
  }
}

export function markBgJobDone(id: string, exitCode: number): void {
  const entry = registry.get(id);
  if (!entry) return;
  // A requested kill is finalized only when the process exit observer runs.
  if (entry.status === "stopping") {
    finalizeKilled(entry);
    return;
  }
  // A confirmed kill must not be overwritten by a racing stream-drain callback.
  if (entry.status === "killed") return;
  entry.status = exitCode === 0 ? "done" : "failed";
  entry.exitCode = exitCode;
  entry.endedAt = Date.now();

  const note = exitCode === 0
    ? `[${id}] '${entry.command.slice(0, 60)}' finished (exit 0).`
    : `[${id}] '${entry.command.slice(0, 60)}' exited with code ${exitCode}.`;

  pendingBgNotifications.push(note);
  Bus.publish(BgJobEvents.Changed, { id, status: entry.status });
}

export function getBgJob(id: string): BgJobEntry | undefined {
  return registry.get(id);
}

export function listBgJobs(): BgJob[] {
  return [...registry.values()];
}

export function getBgOutput(id: string): string | null {
  const entry = registry.get(id);
  if (!entry) return null;
  return entry.ringBuffer.join("\n");
}

export async function killBgJob(id: string): Promise<boolean> {
  const entry = registry.get(id);
  if (!entry || !isBgJobActive(entry)) return false;
  return terminateBgJob(entry);
}

export interface BgJobRevocationResult {
  stoppedJobs: number;
  failedJobIds: string[];
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function confirmProcessStopped(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isProcessRunning(pid);
}

function isBgJobActive(entry: BgJob): boolean {
  return entry.status === "running" || entry.status === "stopping";
}

function finalizeKilled(entry: BgJobEntry): void {
  if (entry.status === "killed") return;
  entry.status = "killed";
  entry.endedAt = Date.now();
  Bus.publish(BgJobEvents.Changed, { id: entry.id, status: entry.status });
}

/** Single-flight, fail-closed termination shared by every asynchronous caller. */
async function terminateBgJob(entry: BgJobEntry): Promise<boolean> {
  if (entry.status === "killed") return true;
  if (!isBgJobActive(entry)) return false;
  if (entry.terminationPromise) return entry.terminationPromise;

  entry.status = "stopping";
  Bus.publish(BgJobEvents.Changed, { id: entry.id, status: entry.status });

  const termination = (async () => {
    try {
      await entry.kill();
    } catch {
      // The scoped process-tree fallback below may still confirm termination.
    }

    if (entry.pid !== undefined && isProcessRunning(entry.pid)) {
      await killProcessTree(entry.pid);
    }

    const confirmedStopped =
      entry.status === "killed" ||
      (entry.pid !== undefined && await confirmProcessStopped(entry.pid));
    if (confirmedStopped) {
      finalizeKilled(entry);
      return true;
    }

    if (entry.status === "stopping") {
      entry.status = "running";
      Bus.publish(BgJobEvents.Changed, { id: entry.id, status: entry.status });
    }
    return false;
  })();

  entry.terminationPromise = termination;
  try {
    return await termination;
  } finally {
    if (entry.terminationPromise === termination) {
      delete entry.terminationPromise;
    }
  }
}

/**
 * Revoke all tracked background mutation authority. Unlike exit cleanup, this
 * operation is fail-closed: jobs are marked killed only after their PID exits.
 */
export async function revokeRunningBgJobs(): Promise<BgJobRevocationResult> {
  let stoppedJobs = 0;
  const failedJobIds: string[] = [];
  const running = [...registry.values()].filter(isBgJobActive);

  for (const entry of running) {
    const confirmedStopped = await terminateBgJob(entry);
    if (!confirmedStopped) {
      failedJobIds.push(entry.id);
      continue;
    }
    stoppedJobs++;
  }

  return { stoppedJobs, failedJobIds };
}

export function countRunningBgJobs(): number {
  return [...registry.values()].filter(isBgJobActive).length;
}

/** Terminate and clear tracked jobs only after every active PID is confirmed stopped. */
export async function cleanupAllBgJobs(): Promise<BgJobRevocationResult> {
  const result = await revokeRunningBgJobs();
  if (result.failedJobIds.length === 0) {
    registry.clear();
  } else {
    for (const [id, entry] of registry) {
      if (!isBgJobActive(entry)) registry.delete(id);
    }
  }
  pendingBgNotifications.length = 0;
  return result;
}

/**
 * Synchronous variant for a `process.on("exit")` handler, where async work
 * cannot complete. Bypasses each entry's (async) kill callback and reaps the
 * process tree directly. Best-effort; must never throw.
 */
export function cleanupAllBgJobsSync(): void {
  for (const [, entry] of registry) {
    if (!isBgJobActive(entry)) continue;
    try {
      if (entry.pid) killProcessTreeSync(entry.pid);
    } catch {
      /* best-effort, process is exiting anyway */
    }
  }
}
