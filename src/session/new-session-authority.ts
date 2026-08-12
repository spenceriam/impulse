import type { Mode } from "../constants.js";
import {
  restoreAskExecutionAdmissionAfterFailure,
} from "../tools/execution-admission.js";
import {
  restoreAgentAuthorityAfterLifecycle,
  setCurrentMode,
} from "../tools/mode-state.js";

export type NewSessionAuthorityResult<T> =
  | { ok: true; mode: "ASK"; session: T; notice: null }
  | { ok: false; mode: Mode; session: null; notice: string; error: Error };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Complete a post-cleanup /new transaction without losing the prior runtime authority on failure. */
export async function createNewSessionWithAuthority<T>(input: {
  currentMode: Mode;
  create(): Promise<T>;
}): Promise<NewSessionAuthorityResult<T>> {
  try {
    const session = await input.create();
    setCurrentMode("ASK");
    return { ok: true, mode: "ASK", session, notice: null };
  } catch (caught) {
    const error = asError(caught);
    if (input.currentMode === "AGENT") {
      restoreAgentAuthorityAfterLifecycle();
    } else {
      restoreAskExecutionAdmissionAfterFailure();
    }
    setCurrentMode(input.currentMode);
    return {
      ok: false,
      mode: input.currentMode,
      session: null,
      notice: `New session failed -- continuing old session in ${input.currentMode}: ${error.message}`,
      error,
    };
  }
}
