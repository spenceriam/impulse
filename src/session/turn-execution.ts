import { isExecutionRegistrationAdmitted } from "../tools/execution-admission.js";

export interface AgentTurnExecutionRegistration {
  id: string;
  accepted: boolean;
  complete(): void;
}

interface AgentTurnExecutionEntry {
  id: string;
  abort(): void;
  completion: Promise<void>;
  complete(): void;
  abortRequested: boolean;
}

export interface AgentTurnRevocationResult {
  failedExecutionIds: string[];
}

const EXIT_CONFIRM_TIMEOUT_MS = 1_500;
const activeExecutions = new Map<string, AgentTurnExecutionEntry>();
let executionCounter = 0;

/** Register one active main-agent turn as an execution participant. */
export function registerAgentTurnExecution(
  abort: () => void,
  options?: { mutating?: boolean }
): AgentTurnExecutionRegistration {
  const id = `agent-turn-${++executionCounter}`;
  if (!isExecutionRegistrationAdmitted(undefined, options)) {
    return { id, accepted: false, complete() {} };
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
  const entry: AgentTurnExecutionEntry = {
    id,
    abort,
    completion,
    complete,
    abortRequested: false,
  };
  activeExecutions.set(id, entry);
  return { id, accepted: true, complete };
}

async function confirmTurnStopped(entry: AgentTurnExecutionEntry): Promise<boolean> {
  return Promise.race([
    entry.completion.then(() => true),
    new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), EXIT_CONFIRM_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Cancel active agent turns. External transitions await the turn's confirmed
 * post-tool boundary. Model de-escalation schedules this awaited phase and only
 * commits ASK after the initiating tool call returns and the turn unregisters.
 */
export async function revokeAgentTurnExecutions(options?: {
  waitForCompletion?: boolean;
}): Promise<AgentTurnRevocationResult> {
  const waitForCompletion = options?.waitForCompletion ?? true;
  const failedExecutionIds: string[] = [];
  const entries = [...activeExecutions.values()];

  for (const entry of entries) {
    if (!entry.abortRequested) {
      entry.abortRequested = true;
      try {
        entry.abort();
      } catch {
        if (!waitForCompletion) failedExecutionIds.push(entry.id);
      }
    }
  }

  if (waitForCompletion) {
    await Promise.all(entries.map(async (entry) => {
      if (!(await confirmTurnStopped(entry))) failedExecutionIds.push(entry.id);
    }));
  }

  return { failedExecutionIds };
}

export function countActiveAgentTurnExecutions(): number {
  return activeExecutions.size;
}

/** Shared tool/provider continuation boundary after execution revocation. */
export function canContinueAgentExecution(signal: AbortSignal): boolean {
  return !signal.aborted;
}
