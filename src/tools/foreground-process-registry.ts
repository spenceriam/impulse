import { killProcessTreeSync } from "../util/process-tree.js";
import {
  isExecutionRegistrationAdmitted,
  type ExecutionStartRegistration,
} from "./execution-admission.js";

export interface ForegroundProcessRegistration {
  id: string;
  accepted: boolean;
  terminationConfirmed?: boolean;
}

interface ForegroundProcessEntry {
  id: string;
  pid?: number;
  kill(): void | Promise<void>;
  exited: Promise<unknown>;
  status: "running" | "stopping";
  terminationPromise?: Promise<boolean>;
}

export interface ForegroundProcessRevocationResult {
  stoppedProcesses: number;
  failedProcessIds: string[];
}

const EXIT_CONFIRM_TIMEOUT_MS = 750;
const registry = new Map<string, ForegroundProcessEntry>();
let processCounter = 0;

function trackForegroundProcess(entry: ForegroundProcessEntry): void {
  registry.set(entry.id, entry);
  void entry.exited.then(
    () => {
      if (registry.get(entry.id) === entry) registry.delete(entry.id);
    },
    () => {
      // A rejected observer does not prove process exit. Keep it revocable.
    }
  );
}

/** Register an Impulse-owned foreground process until its exit promise settles. */
export async function registerForegroundProcess(input: {
  pid?: number;
  kill(): void | Promise<void>;
  exited: Promise<unknown>;
  admission: ExecutionStartRegistration;
}): Promise<ForegroundProcessRegistration> {
  const id = `foreground-${++processCounter}`;
  const entry: ForegroundProcessEntry = {
    id,
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    kill: input.kill,
    exited: input.exited,
    status: "running",
  };
  trackForegroundProcess(entry);

  if (!isExecutionRegistrationAdmitted(input.admission)) {
    const terminationConfirmed = await terminateForegroundProcess(entry);
    input.admission.complete();
    return { id, accepted: false, terminationConfirmed };
  }

  input.admission.complete();
  return { id, accepted: true };
}

function confirmExit(entry: ForegroundProcessEntry): Promise<boolean> {
  return Promise.race([
    entry.exited.then(() => true, () => false),
    new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), EXIT_CONFIRM_TIMEOUT_MS);
    }),
  ]);
}

/** Single-flight cancellation that reports success only after observed exit. */
async function terminateForegroundProcess(entry: ForegroundProcessEntry): Promise<boolean> {
  if (!registry.has(entry.id)) return true;
  if (entry.terminationPromise) return entry.terminationPromise;

  entry.status = "stopping";
  const termination = (async () => {
    try {
      await entry.kill();
    } catch {
      // Exit observation below remains the source of truth.
    }

    const confirmed = await confirmExit(entry);
    if (confirmed) {
      registry.delete(entry.id);
      return true;
    }

    entry.status = "running";
    return false;
  })();

  entry.terminationPromise = termination;
  try {
    return await termination;
  } finally {
    if (entry.terminationPromise === termination) delete entry.terminationPromise;
  }
}

/** Revoke all currently active foreground tool processes, failing closed. */
export async function revokeForegroundProcesses(): Promise<ForegroundProcessRevocationResult> {
  let stoppedProcesses = 0;
  const failedProcessIds: string[] = [];
  const active = [...registry.values()];

  await Promise.all(active.map(async (entry) => {
    if (await terminateForegroundProcess(entry)) {
      stoppedProcesses++;
    } else {
      failedProcessIds.push(entry.id);
    }
  }));

  return { stoppedProcesses, failedProcessIds };
}

export function countForegroundProcesses(): number {
  return registry.size;
}

/** Best-effort crash/process-exit fallback; normal paths await revocation. */
export function cleanupForegroundProcessesSync(): void {
  for (const entry of registry.values()) {
    if (entry.pid === undefined) continue;
    try {
      killProcessTreeSync(entry.pid);
    } catch {
      // Process exit fallback must not throw.
    }
  }
}
