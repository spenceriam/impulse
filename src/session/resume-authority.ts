import { normalizeMode, type Mode } from "../constants.js";
import { cleanupExecutionParticipants } from "../tools/execution-revocation.js";
import {
  reopenExecutionAdmissionAfterFailure,
  restoreAskExecutionAdmissionAfterFailure,
} from "../tools/execution-admission.js";
import {
  restoreAgentAuthorityAfterLifecycle,
  setCurrentMode,
} from "../tools/mode-state.js";

export interface ResumeAuthorityGateway<T extends { mode: string }> {
  currentMode: Mode;
  /** Read canonical session metadata without mutating it or making it current. */
  inspect(): Promise<T>;
  /** Make the inspected session current only after authority is resolved. */
  commit(): Promise<T>;
}

export interface ResumeAuthorityResult<T extends { mode: string }> {
  ok: boolean;
  mode: Mode;
  storedMode: Mode;
  session: T | null;
  stoppedJobs: number;
  stoppedShells: number;
  failedParticipantIds: string[];
  notice: string | null;
}

function resumeFailureNotice(mode: Mode, failedParticipantIds: string[]): string {
  return `Resume blocked -- failed to stop ${failedParticipantIds.join(", ")}; session unchanged in ${mode}`;
}

function resumeAskNotice(stoppedJobs: number, stoppedShells: number): string {
  const stopped: string[] = [];
  if (stoppedJobs > 0) {
    stopped.push(`${stoppedJobs} bg ${stoppedJobs === 1 ? "job" : "jobs"}`);
  }
  if (stoppedShells > 0) stopped.push("shell");
  const suffix = stopped.length > 0 ? `; stopped ${stopped.join(" + ")}` : "";
  return `Session restored in ASK -- execution authority revoked${suffix}`;
}

/**
 * Resolve runtime authority before committing a session resume.
 *
 * Persisted mode is historical metadata. It may reduce current authority after
 * confirmed revocation, but it can never elevate an ASK runtime.
 */
export async function resumeSessionWithAuthority<T extends { mode: string }>(
  gateway: ResumeAuthorityGateway<T>
): Promise<ResumeAuthorityResult<T>> {
  const inspected = await gateway.inspect();
  const storedMode = normalizeMode(inspected.mode);
  const currentMode = gateway.currentMode;
  const cleanup = await cleanupExecutionParticipants("resume");

  if (!cleanup.ok) {
    return {
      ok: false,
      mode: currentMode,
      storedMode,
      session: null,
      stoppedJobs: cleanup.stoppedJobs,
      stoppedShells: cleanup.stoppedShells,
      failedParticipantIds: cleanup.failedParticipantIds,
      notice: resumeFailureNotice(currentMode, cleanup.failedParticipantIds),
    };
  }

  const runtimeMode: Mode = currentMode === "ASK" || storedMode === "ASK"
    ? "ASK"
    : "AGENT";

  let session: T;
  try {
    session = await gateway.commit();
  } catch (error) {
    if (currentMode === "AGENT") reopenExecutionAdmissionAfterFailure();
    else restoreAskExecutionAdmissionAfterFailure();
    throw error;
  }
  if (runtimeMode === "AGENT") restoreAgentAuthorityAfterLifecycle();
  setCurrentMode(runtimeMode);

  if (currentMode === "ASK" && storedMode === "AGENT") {
    return {
      ok: true,
      mode: runtimeMode,
      storedMode,
      session,
      stoppedJobs: cleanup.stoppedJobs,
      stoppedShells: cleanup.stoppedShells,
      failedParticipantIds: [],
      notice:
        "Session restored in ASK -- stored AGENT authority was not resumed. Use /mode AGENT or Tab to switch explicitly.",
    };
  }

  if (currentMode === "AGENT" && storedMode === "ASK") {
    return {
      ok: true,
      mode: runtimeMode,
      storedMode,
      session,
      stoppedJobs: cleanup.stoppedJobs,
      stoppedShells: cleanup.stoppedShells,
      failedParticipantIds: [],
      notice: resumeAskNotice(cleanup.stoppedJobs, cleanup.stoppedShells),
    };
  }

  return {
    ok: true,
    mode: runtimeMode,
    storedMode,
    session,
    stoppedJobs: cleanup.stoppedJobs,
    stoppedShells: cleanup.stoppedShells,
    failedParticipantIds: [],
    notice: null,
  };
}
