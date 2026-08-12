import { isExecutionAdmissionOpen } from "../tools/execution-admission.js";

export interface GoalLoopExecutionRegistration {
  id: string;
  signal: AbortSignal;
  accepted: boolean;
  complete(): void;
}

interface GoalLoopExecutionEntry {
  id: string;
  controller: AbortController;
  completion: Promise<void>;
  complete(): void;
  cancelRequested: boolean;
}

export interface GoalLoopExecutionRevocationResult {
  failedExecutionIds: string[];
}

const EXIT_CONFIRM_TIMEOUT_MS = 1_500;
const activeExecutions = new Map<string, GoalLoopExecutionEntry>();
let executionCounter = 0;

/** Register autonomous goal work while it may call a provider or mutate state. */
export function registerGoalLoopExecution(): GoalLoopExecutionRegistration {
  const id = `goal-loop-${++executionCounter}`;
  const controller = new AbortController();
  if (!isExecutionAdmissionOpen()) {
    controller.abort();
    return { id, signal: controller.signal, accepted: false, complete() {} };
  }
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    activeExecutions.delete(id);
    resolveCompletion();
  };
  activeExecutions.set(id, {
    id,
    controller,
    completion,
    complete,
    cancelRequested: false,
  });
  return { id, signal: controller.signal, accepted: true, complete };
}

async function confirmGoalWorkStopped(entry: GoalLoopExecutionEntry): Promise<boolean> {
  return Promise.race([
    entry.completion.then(() => true),
    new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), EXIT_CONFIRM_TIMEOUT_MS);
    }),
  ]);
}

/** Cancel autonomous goal work and optionally await its confirmed boundary. */
export async function revokeGoalLoopExecutions(options?: {
  waitForCompletion?: boolean;
}): Promise<GoalLoopExecutionRevocationResult> {
  const waitForCompletion = options?.waitForCompletion ?? true;
  const entries = [...activeExecutions.values()];

  for (const entry of entries) {
    if (entry.cancelRequested) continue;
    entry.cancelRequested = true;
    entry.controller.abort();
  }

  const failedExecutionIds: string[] = [];
  if (waitForCompletion) {
    await Promise.all(entries.map(async (entry) => {
      if (!(await confirmGoalWorkStopped(entry))) failedExecutionIds.push(entry.id);
    }));
  }

  return { failedExecutionIds };
}

export function countActiveGoalLoopExecutions(): number {
  return activeExecutions.size;
}
