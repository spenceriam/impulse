import fs from "fs";
import { getCurrentMode, setCurrentMode } from "../../src/tools/mode-state.js";
import {
  getExecutionAdmissionState,
  isExecutionAdmissionOpen,
  registerExecutionStart,
} from "../../src/tools/execution-admission.js";
import { transitionModeAuthority } from "../../src/tools/mode-transition.js";
import { runUserShellCommand } from "../../src/cli/user-shell.js";
import { Tool } from "../../src/tools/registry.js";
import "../../src/tools/bash.js";

function commandFor(target: string): string {
  return process.platform === "win32"
    ? `Set-Content -Path '${target.replaceAll("'", "''")}' -Value x`
    : `printf x > ${JSON.stringify(target)}`;
}

function outputCommand(): string {
  return "echo agent-tool";
}

const scenario = process.argv[2];

if (scenario === "initial") {
  const target = process.argv[3]!;
  const toolTarget = `${target}.tool`;
  let shellError = "";
  try {
    await runUserShellCommand({ command: commandFor(target), onData: () => {} });
  } catch (error) {
    shellError = error instanceof Error ? error.message : String(error);
  }
  const toolResult = await Tool.execute("bash", {
    command: commandFor(toolTarget),
    description: "prove fresh ASK blocks the bash tool",
  });
  const mutating = registerExecutionStart("fresh-foreground", () => {});
  const readOnly = registerExecutionStart("fresh-read", () => {}, { mutating: false });
  readOnly.complete();
  process.stdout.write(JSON.stringify({
    mode: getCurrentMode(),
    admission: getExecutionAdmissionState(),
    mutationOpen: isExecutionAdmissionOpen(),
    shellError,
    targetExists: fs.existsSync(target),
    toolRejected: !toolResult.success && !fs.existsSync(toolTarget),
    mutatingAccepted: mutating.accepted,
    readOnlyAccepted: readOnly.accepted,
  }));
} else if (scenario === "transition") {
  const shellTarget = process.argv[3]!;

  setCurrentMode("AGENT");
  const directAssignment = {
    mode: getCurrentMode(),
    admission: getExecutionAdmissionState(),
  };
  setCurrentMode("ASK");

  const modelElevation = await transitionModeAuthority("ASK", "AGENT", { source: "model" });
  const afterModel = {
    mode: getCurrentMode(),
    admission: getExecutionAdmissionState(),
  };
  setCurrentMode("ASK");

  const explicitElevation = await transitionModeAuthority("ASK", "AGENT", { source: "external" });
  const elevatedMode = getCurrentMode();
  const elevatedAdmission = getExecutionAdmissionState();
  const foreground = registerExecutionStart("explicit-foreground", () => {});
  foreground.complete();
  const shellResult = await runUserShellCommand({
    command: commandFor(shellTarget),
    onData: () => {},
  });
  const toolResult = await Tool.execute("bash", {
    command: outputCommand(),
    description: "prove explicit AGENT authority runs the bash tool",
  });

  const downgrade = await transitionModeAuthority("AGENT", "ASK", { source: "external" });
  const afterDowngrade = registerExecutionStart("downgraded-foreground", () => {});
  const readOnlyAfterDowngrade = registerExecutionStart(
    "downgraded-read",
    () => {},
    { mutating: false }
  );
  readOnlyAfterDowngrade.complete();

  process.stdout.write(JSON.stringify({
    directAssignment,
    modelElevation,
    afterModel,
    explicitElevation,
    elevatedMode,
    elevatedAdmission,
    shellWorked: shellResult.success && fs.existsSync(shellTarget),
    toolWorked: toolResult.success && toolResult.output.includes("agent-tool"),
    foregroundAccepted: foreground.accepted,
    downgrade,
    finalMode: getCurrentMode(),
    finalAdmission: getExecutionAdmissionState(),
    afterDowngradeAccepted: afterDowngrade.accepted,
    readOnlyAfterDowngradeAccepted: readOnlyAfterDowngrade.accepted,
  }));
} else {
  throw new Error(`Unknown fresh-authority scenario: ${scenario}`);
}
