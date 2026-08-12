import type { Mode } from "../constants.js";

/** User-facing guard for direct UI actions that bypass the model tool registry. */
export function agentAuthorityError(mode: Mode, action: string): string | null {
  return mode === "AGENT"
    ? null
    : `${action} requires AGENT. Switch with /mode AGENT or Tab.`;
}

/** Visible confirmation for authority changes initiated directly by the user. */
export function explicitUserModeTransitionNotice(
  previousMode: Mode,
  nextMode: Mode,
  stoppedJobs = 0,
  stoppedShells = 0
): string | null {
  if (previousMode === nextMode) return null;
  const base = nextMode === "AGENT"
    ? "Mode: ASK -> AGENT -- execution authority enabled"
    : "Mode: AGENT -> ASK -- read-only";
  if (nextMode !== "ASK") return base;
  const stopped: string[] = [];
  if (stoppedJobs > 0) {
    stopped.push(`${stoppedJobs} bg ${stoppedJobs === 1 ? "job" : "jobs"}`);
  }
  if (stoppedShells > 0) stopped.push("shell");
  return stopped.length > 0 ? `${base}; stopped ${stopped.join(" + ")}` : base;
}

/** Visible completion for a model-requested de-escalation that settled later. */
export function modelModeTransitionCommittedNotice(
  previousMode: Mode,
  nextMode: Mode,
  reason?: string
): string {
  const base = nextMode === "ASK"
    ? `Mode: ${previousMode} -> ASK -- read-only`
    : `Mode: ${previousMode} -> AGENT -- execution authority enabled`;
  return reason ? `${base} (${reason})` : base;
}

export function modeTransitionFailureNotice(
  stoppedJobs: number,
  failedJobIds: string[],
  stoppedShells = 0
): string {
  const stopped: string[] = [];
  if (stoppedJobs > 0) {
    stopped.push(`${stoppedJobs} bg ${stoppedJobs === 1 ? "job" : "jobs"}`);
  }
  if (stoppedShells > 0) stopped.push("shell");
  const stoppedText = stopped.length > 0 ? `stopped ${stopped.join(" + ")}; ` : "";
  return `Mode remains AGENT -- ${stoppedText}failed to stop ${failedJobIds.join(", ")}`;
}
