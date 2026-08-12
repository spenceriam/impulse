import {
  cleanupActiveUserShellSync,
  revokeActiveUserShell,
} from "../cli/user-shell.js";
import {
  cleanupAllBgJobs,
  cleanupAllBgJobsSync,
  revokeRunningBgJobs,
} from "./bg-process-registry.js";
import {
  cleanupForegroundProcessesSync,
  revokeForegroundProcesses,
} from "./foreground-process-registry.js";
import { revokeAgentTurnExecutions } from "../session/turn-execution.js";
import { revokeGoalLoopExecutions } from "../agent/goal-execution.js";
import {
  closeExecutionAdmission,
  commitClosedExecutionAdmission,
  countStartingExecutionParticipants,
  revokeExecutionStarts,
  reopenExecutionAdmissionAfterFailure,
  restoreAskExecutionAdmissionAfterFailure,
} from "./execution-admission.js";
import { countActiveGoalLoopExecutions } from "../agent/goal-execution.js";
import { countActiveAgentTurnExecutions } from "../session/turn-execution.js";
import { countRunningBgJobs } from "./bg-process-registry.js";
import { countForegroundProcesses } from "./foreground-process-registry.js";
import { isUserShellActive } from "../cli/user-shell.js";
import { getCurrentMode } from "./mode-state.js";

export interface ExecutionRevocationResult {
  stoppedJobs: number;
  stoppedShells: number;
  failedParticipantIds: string[];
}

interface ExecutionParticipant {
  revoke(): Promise<ExecutionRevocationResult>;
  cleanup(): Promise<ExecutionRevocationResult>;
}

const executionParticipants: ExecutionParticipant[] = [
  {
    async revoke() {
      const result = await revokeExecutionStarts({ waitForCompletion: true });
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedStartIds,
      };
    },
    async cleanup() {
      const result = await revokeExecutionStarts({ waitForCompletion: true });
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedStartIds,
      };
    },
  },
  {
    async revoke() {
      const result = await revokeGoalLoopExecutions({ waitForCompletion: true });
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedExecutionIds,
      };
    },
    async cleanup() {
      const result = await revokeGoalLoopExecutions({ waitForCompletion: true });
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedExecutionIds,
      };
    },
  },
  {
    async revoke() {
      const result = await revokeAgentTurnExecutions({ waitForCompletion: true });
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedExecutionIds,
      };
    },
    async cleanup() {
      const result = await revokeAgentTurnExecutions({ waitForCompletion: true });
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedExecutionIds,
      };
    },
  },
  {
    async revoke() {
      const result = await revokeRunningBgJobs();
      return {
        stoppedJobs: result.stoppedJobs,
        stoppedShells: 0,
        failedParticipantIds: result.failedJobIds,
      };
    },
    async cleanup() {
      const result = await cleanupAllBgJobs();
      return {
        stoppedJobs: result.stoppedJobs,
        stoppedShells: 0,
        failedParticipantIds: result.failedJobIds,
      };
    },
  },
  {
    async revoke() {
      const result = await revokeForegroundProcesses();
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedProcessIds,
      };
    },
    async cleanup() {
      const result = await revokeForegroundProcesses();
      return {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: result.failedProcessIds,
      };
    },
  },
  {
    async revoke() {
      const result = await revokeActiveUserShell();
      return {
        stoppedJobs: 0,
        stoppedShells: result.stoppedShells,
        failedParticipantIds: result.failedParticipantIds,
      };
    },
    async cleanup() {
      const result = await revokeActiveUserShell();
      return {
        stoppedJobs: 0,
        stoppedShells: result.stoppedShells,
        failedParticipantIds: result.failedParticipantIds,
      };
    },
  },
];

async function runParticipantOperation(
  operation: "revoke" | "cleanup"
): Promise<ExecutionRevocationResult> {
  const results = await Promise.all(
    executionParticipants.map((participant) =>
      operation === "revoke" ? participant.revoke() : participant.cleanup()
    )
  );
  return results.reduce<ExecutionRevocationResult>(
    (combined, result) => ({
      stoppedJobs: combined.stoppedJobs + result.stoppedJobs,
      stoppedShells: combined.stoppedShells + result.stoppedShells,
      failedParticipantIds: [...combined.failedParticipantIds, ...result.failedParticipantIds],
    }),
    { stoppedJobs: 0, stoppedShells: 0, failedParticipantIds: [] }
  );
}

function combineRevocationResults(
  left: ExecutionRevocationResult,
  right: ExecutionRevocationResult
): ExecutionRevocationResult {
  return {
    stoppedJobs: left.stoppedJobs + right.stoppedJobs,
    stoppedShells: left.stoppedShells + right.stoppedShells,
    failedParticipantIds: [...left.failedParticipantIds, ...right.failedParticipantIds],
  };
}

function countActiveExecutionParticipants(): number {
  return countStartingExecutionParticipants() +
    countActiveGoalLoopExecutions() +
    countActiveAgentTurnExecutions() +
    countRunningBgJobs() +
    countForegroundProcesses() +
    (isUserShellActive() ? 1 : 0);
}

async function runUntilExecutionQuiesces(
  operation: "revoke" | "cleanup"
): Promise<ExecutionRevocationResult> {
  let combined: ExecutionRevocationResult = {
    stoppedJobs: 0,
    stoppedShells: 0,
    failedParticipantIds: [],
  };

  while (true) {
    const result = await runParticipantOperation(operation);
    combined = combineRevocationResults(combined, result);
    if (combined.failedParticipantIds.length > 0) return combined;

    // Let pre-close starts finish their handoff, then require two stable empty checks.
    await Promise.resolve();
    if (countActiveExecutionParticipants() > 0) continue;
    await Promise.resolve();
    if (countActiveExecutionParticipants() === 0) return combined;
  }
}

interface ActiveRevocationPhase {
  operation: "revoke" | "cleanup";
  promise: Promise<ExecutionRevocationResult>;
}

let activeRevocationPhase: ActiveRevocationPhase | null = null;

function settleExecutionAdmission(result: ExecutionRevocationResult): void {
  if (result.failedParticipantIds.length === 0) {
    commitClosedExecutionAdmission();
  } else if (getCurrentMode() === "AGENT") {
    reopenExecutionAdmissionAfterFailure();
  } else {
    restoreAskExecutionAdmissionAfterFailure();
  }
}

function runClosedRevocationPhase(
  operation: "revoke" | "cleanup"
): Promise<ExecutionRevocationResult> {
  if (activeRevocationPhase) {
    if (activeRevocationPhase.operation === operation) {
      return activeRevocationPhase.promise;
    }
    return activeRevocationPhase.promise.then(() =>
      runClosedRevocationPhase(operation)
    );
  }

  closeExecutionAdmission();
  // Defer participant callbacks until the shared phase is published, so a
  // re-entrant cleanup from an abort callback joins instead of forking a sweep.
  const operationPromise = Promise.resolve().then(() =>
    runUntilExecutionQuiesces(operation)
  );
  const phasePromise = operationPromise.then(
    (result) => {
      settleExecutionAdmission(result);
      return result;
    },
    () => {
      const result: ExecutionRevocationResult = {
        stoppedJobs: 0,
        stoppedShells: 0,
        failedParticipantIds: ["execution-revocation"],
      };
      settleExecutionAdmission(result);
      return result;
    }
  );

  const phase: ActiveRevocationPhase = { operation, promise: phasePromise };
  activeRevocationPhase = phase;
  void phasePromise.then(() => {
    if (activeRevocationPhase === phase) activeRevocationPhase = null;
  });
  return phasePromise;
}

/** Revoke every Impulse-owned execution participant before authority changes. */
export async function revokeExecutionParticipants(): Promise<ExecutionRevocationResult> {
  return runClosedRevocationPhase("revoke");
}

export type ExecutionCleanupContext =
  | "new-session"
  | "resume"
  | "exit"
  | "update"
  | "tui-stop";

export interface ExecutionCleanupResult extends ExecutionRevocationResult {
  ok: boolean;
  context: ExecutionCleanupContext;
  notice: string | null;
}

export function executionCleanupFailureNotice(
  context: ExecutionCleanupContext,
  failedParticipantIds: string[]
): string {
  const failed = failedParticipantIds.join(", ");
  switch (context) {
    case "new-session":
      return `New session blocked -- failed to stop ${failed}`;
    case "resume":
      return `Resume blocked -- failed to stop ${failed}`;
    case "update":
      return `Update relaunch blocked -- failed to stop ${failed}`;
    case "exit":
      return `Exit blocked -- failed to stop ${failed}; Impulse remains running`;
    case "tui-stop":
      return `Action blocked -- failed to stop ${failed}`;
  }
}

/** Await and confirm lifecycle cleanup for every Impulse-owned execution participant. */
export async function cleanupExecutionParticipants(
  context: ExecutionCleanupContext
): Promise<ExecutionCleanupResult> {
  const result = await runClosedRevocationPhase("cleanup");
  const ok = result.failedParticipantIds.length === 0;
  return {
    ok,
    context,
    ...result,
    notice: ok ? null : executionCleanupFailureNotice(context, result.failedParticipantIds),
  };
}

/** Best-effort crash/process-exit fallback; normal lifecycle paths use awaited cleanup. */
export function cleanupExecutionParticipantsSync(): void {
  cleanupAllBgJobsSync();
  cleanupForegroundProcessesSync();
  cleanupActiveUserShellSync();
}
