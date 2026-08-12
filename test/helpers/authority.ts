import { getCurrentMode, setCurrentMode } from "../../src/tools/mode-state.js";
import { transitionModeAuthority } from "../../src/tools/mode-transition.js";

/** Enter AGENT through the same explicit-user authority route used by Tab and /mode. */
export async function enterAgentModeForTest(): Promise<void> {
  if (getCurrentMode() === "AGENT") return;
  setCurrentMode("ASK");
  const result = await transitionModeAuthority("ASK", "AGENT", { source: "external" });
  if (!result.changed || result.mode !== "AGENT") {
    throw new Error(`Unable to enter AGENT in test: ${result.failedJobIds.join(", ")}`);
  }
}
