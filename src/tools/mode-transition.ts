import type { Mode } from "../constants.js";
import { Bus, ModeEvents } from "../bus/index.js";
import { revokeExecutionParticipants } from "./execution-revocation.js";
import { openExecutionAdmissionForAgentTransition } from "./execution-admission.js";
import { setCurrentMode } from "./mode-state.js";

export interface ModeAuthorityTransitionResult {
  changed: boolean;
  mode: Mode;
  requestedMode?: Mode;
  pending?: boolean;
  duplicate?: boolean;
  stoppedJobs: number;
  failedJobIds: string[];
  stoppedShells?: number;
}

interface PendingModelDeescalation {
  completion: Promise<void>;
}

let pendingModelDeescalation: PendingModelDeescalation | null = null;

async function scheduleModelDeescalation(
  reason?: string
): Promise<ModeAuthorityTransitionResult> {
  const existing = pendingModelDeescalation;
  if (existing) {
    await Promise.resolve();
    return {
      changed: false,
      mode: "AGENT",
      requestedMode: "ASK",
      pending: true,
      duplicate: true,
      stoppedJobs: 0,
      failedJobIds: [],
    };
  }

  const revocation = revokeExecutionParticipants();
  const pending: PendingModelDeescalation = {
    completion: Promise.resolve(),
  };
  pendingModelDeescalation = pending;
  pending.completion = revocation.then((result) => {
    if (result.failedParticipantIds.length === 0) {
      setCurrentMode("ASK");
      Bus.publish(ModeEvents.Changed, { mode: "ASK", reason });
    } else {
      Bus.publish(ModeEvents.TransitionFailed, {
        mode: "AGENT",
        requestedMode: "ASK",
        failedParticipantIds: result.failedParticipantIds,
        stoppedJobs: result.stoppedJobs,
        stoppedShells: result.stoppedShells,
        reason,
      });
    }
  }).finally(() => {
    if (pendingModelDeescalation === pending) pendingModelDeescalation = null;
  });

  // The shared revocation phase starts on a microtask so re-entrant cleanup can
  // join it. Yield once to ensure the initiating turn has been signalled before
  // the set_mode tool reports its pending result.
  await Promise.resolve();
  return {
    changed: false,
    mode: "AGENT",
    requestedMode: "ASK",
    pending: true,
    stoppedJobs: 0,
    failedJobIds: [],
  };
}

/** Resolve a mode transition only after any required authority revocation succeeds. */
export async function transitionModeAuthority(
  currentMode: Mode,
  nextMode: Mode,
  options?: { source?: "external" | "model"; reason?: string }
): Promise<ModeAuthorityTransitionResult> {
  if (currentMode === nextMode) {
    return { changed: false, mode: currentMode, stoppedJobs: 0, failedJobIds: [] };
  }

  if (currentMode === "AGENT" && nextMode === "ASK") {
    if (options?.source === "model") {
      return scheduleModelDeescalation(options.reason);
    }

    const revocation = await revokeExecutionParticipants();
    if (revocation.failedParticipantIds.length > 0) {
      return {
        changed: false,
        mode: "AGENT",
        stoppedJobs: revocation.stoppedJobs,
        failedJobIds: revocation.failedParticipantIds,
        ...(revocation.stoppedShells > 0 ? { stoppedShells: revocation.stoppedShells } : {}),
      };
    }
    setCurrentMode("ASK");
    return {
      changed: true,
      mode: "ASK",
      stoppedJobs: revocation.stoppedJobs,
      failedJobIds: [],
      ...(revocation.stoppedShells > 0 ? { stoppedShells: revocation.stoppedShells } : {}),
    };
  }

  if (nextMode === "AGENT" && options?.source === "model") {
    return {
      changed: false,
      mode: currentMode,
      requestedMode: "AGENT",
      stoppedJobs: 0,
      failedJobIds: ["user-confirmation-required"],
    };
  }

  if (nextMode === "AGENT") {
    if (!openExecutionAdmissionForAgentTransition() || !setCurrentMode("AGENT")) {
      setCurrentMode("ASK");
      return {
        changed: false,
        mode: currentMode,
        stoppedJobs: 0,
        failedJobIds: ["execution-admission"],
      };
    }
  }
  return { changed: true, mode: nextMode, stoppedJobs: 0, failedJobIds: [] };
}
