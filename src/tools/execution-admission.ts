import { DEFAULT_MODE, isDefaultMode } from "../constants.js";
import { currentExecutionContext } from "../execution/context.js";

export type ExecutionAdmissionState = "open" | "ask" | "closing" | "closed";

let state: ExecutionAdmissionState = isDefaultMode(DEFAULT_MODE) ? "ask" : "open";
let startCounter = 0;

interface ExecutionStartEntry {
  id: string;
  abort(): void;
  completion: Promise<void>;
  complete(): void;
  abortRequested: boolean;
}

export interface ExecutionStartRegistration {
  id: string;
  accepted: boolean;
  signal: AbortSignal;
  complete(): void;
}

export interface ExecutionStartRevocationResult {
  failedStartIds: string[];
}

const START_CONFIRM_TIMEOUT_MS = 1_500;
const activeStarts = new Map<string, ExecutionStartEntry>();

/** Reserve a starting slot before any await/spawn; later hand it off to a registry. */
export function registerExecutionStart(
  kind: string,
  abort: () => void,
  options?: { mutating?: boolean }
): ExecutionStartRegistration {
  const id = `${kind}-start-${++startCounter}`;
  const controller = new AbortController();
  const mutating = options?.mutating ?? true;
  const execution = currentExecutionContext();
  if (execution?.runtime) {
    const accepted = execution.runtime.canMutate() || !mutating;
    if (!accepted || execution.signal?.aborted) controller.abort();
    const abortForSession = () => controller.abort();
    execution.signal?.addEventListener("abort", abortForSession, { once: true });
    return {
      id,
      accepted: accepted && !controller.signal.aborted,
      signal: controller.signal,
      complete() {
        execution.signal?.removeEventListener("abort", abortForSession);
      },
    };
  }
  if (state !== "open" && !(state === "ask" && !mutating)) {
    controller.abort();
    return { id, accepted: false, signal: controller.signal, complete() {} };
  }

  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    activeStarts.delete(id);
    resolveCompletion();
  };
  activeStarts.set(id, {
    id,
    abort: () => {
      controller.abort();
      abort();
    },
    completion,
    complete,
    abortRequested: false,
  });
  return { id, accepted: true, signal: controller.signal, complete };
}

/** Existing pre-close starts may hand off atomically while admission is closing. */
export function isExecutionRegistrationAdmitted(
  start?: ExecutionStartRegistration,
  options?: { mutating?: boolean }
): boolean {
  const execution = currentExecutionContext();
  if (execution?.runtime) {
    const mutating = options?.mutating ?? true;
    return (execution.runtime.canMutate() || !mutating) &&
      execution.signal?.aborted !== true &&
      (start === undefined || (start.accepted && !start.signal.aborted));
  }
  const mutating = options?.mutating ?? true;
  return state === "open" ||
    (state === "ask" && !mutating) ||
    (start?.accepted === true && !start.signal.aborted);
}

export async function revokeExecutionStarts(options?: {
  waitForCompletion?: boolean;
}): Promise<ExecutionStartRevocationResult> {
  const waitForCompletion = options?.waitForCompletion ?? true;
  const entries = [...activeStarts.values()];
  for (const entry of entries) {
    if (entry.abortRequested) continue;
    entry.abortRequested = true;
    try {
      entry.abort();
    } catch {
      // Completion remains the source of truth.
    }
  }

  const failedStartIds: string[] = [];
  if (waitForCompletion) {
    await Promise.all(entries.map(async (entry) => {
      const confirmed = await Promise.race([
        entry.completion.then(() => true),
        new Promise<false>((resolve) => {
          setTimeout(() => resolve(false), START_CONFIRM_TIMEOUT_MS);
        }),
      ]);
      if (!confirmed) failedStartIds.push(entry.id);
    }));
  }
  return { failedStartIds };
}

export function countStartingExecutionParticipants(): number {
  return activeStarts.size;
}

/** Close mutating participant admission before any revocation snapshot is taken. */
export function closeExecutionAdmission(): void {
  state = "closing";
}

/** Keep admission closed after authority/lifecycle cleanup has reached quiescence. */
export function commitClosedExecutionAdmission(): void {
  state = "closed";
}

/** Explicit authority transfer may open ASK, but never an in-flight/held lifecycle close. */
export function openExecutionAdmissionForAgentTransition(): boolean {
  if (state !== "ask" && state !== "open") return false;
  state = "open";
  return true;
}

/** Roll back a failed close while AGENT remains the active authority. */
export function reopenExecutionAdmissionAfterFailure(): void {
  state = "open";
}

/** Transfer a completed close to ASK: read-only turns resume, mutation stays closed. */
export function setAskExecutionAdmission(): void {
  if (state === "closing") return;
  state = "ask";
}

/** Roll back a failed ASK lifecycle close without granting mutation authority. */
export function restoreAskExecutionAdmissionAfterFailure(): void {
  state = "ask";
}

export function isExecutionAdmissionOpen(): boolean {
  return state === "open";
}

export function isExecutionTurnAdmissionOpen(mutating: boolean): boolean {
  return state === "open" || (state === "ask" && !mutating);
}

export function getExecutionAdmissionState(): ExecutionAdmissionState {
  return state;
}
