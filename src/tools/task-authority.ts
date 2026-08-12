import type { Mode } from "../constants.js";

export function taskModeError(mode: Mode, subagentType: unknown): string | null {
  if (mode !== "ASK" || subagentType === "explore") return null;
  return "ASK mode only allows explore subagents. Use subagent_type=\"explore\" for read-only research, or use execution_handoff so the user can choose Preview safely, Switch to AGENT, or Stay in ASK.";
}
