/**
 * Background process registry — tracks non-blocking bash jobs (#116).
 *
 * A job is created when `bash` is called with `background: true`.
 * Output is buffered in a fixed-size ring buffer (MAX_RING_LINES lines).
 * When a job exits while no agent turn is active, a notification is queued
 * and drained into the conversation at the next turn start via flushTurnInjections.
 */

import { isAgentTurnActive } from "../session/turn-active.js";

export type BgJobStatus = "running" | "done" | "killed" | "failed";

export interface BgJob {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  status: BgJobStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
  kill(): void;
}

interface BgJobEntry extends BgJob {
  ringBuffer: string[];
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
  const done = [...registry.entries()].filter(([, j]) => j.status !== "running");
  done.sort((a, b) => (a[1].startedAt ?? 0) - (b[1].startedAt ?? 0));
  for (const [id] of done.slice(0, registry.size - MAX_JOBS)) {
    registry.delete(id);
  }
}

export function registerBgJob(opts: {
  command: string;
  cwd: string;
  pid?: number;
  kill(): void;
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
  };
  registry.set(id, entry);
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
  entry.status = exitCode === 0 ? "done" : "failed";
  entry.exitCode = exitCode;
  entry.endedAt = Date.now();

  const note = exitCode === 0
    ? `[bg-${id}] '${entry.command.slice(0, 60)}' finished (exit 0).`
    : `[bg-${id}] '${entry.command.slice(0, 60)}' exited with code ${exitCode}.`;

  if (!isAgentTurnActive()) {
    pendingBgNotifications.push(note);
  }
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

export function killBgJob(id: string): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  try {
    entry.kill();
  } catch { /* ignore */ }
  entry.status = "killed";
  entry.endedAt = Date.now();
  return true;
}

export function countRunningBgJobs(): number {
  return [...registry.values()].filter((j) => j.status === "running").length;
}

/** Kill all running jobs — call on process exit or session end. */
export function cleanupAllBgJobs(): void {
  for (const [, entry] of registry) {
    if (entry.status === "running") {
      try { entry.kill(); } catch { /* ignore */ }
    }
  }
  registry.clear();
}
