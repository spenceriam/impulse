import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { WINDOWS_POWERSHELL_WRAPPER } from "../src/tools/bash.js";

const isWindows = process.platform === "win32";
const describeWindows = isWindows ? describe : describe.skip;

function runWrapper(command: string): number {
  const encoded = Buffer.from(WINDOWS_POWERSHELL_WRAPPER, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encoded,
    ],
    {
      env: { ...process.env, IMPULSE_COMMAND: command },
      encoding: "utf-8",
      windowsHide: true,
    }
  );
  return result.status ?? -1;
}

describeWindows("Windows PowerShell wrapper exit-code fidelity", () => {
  test("native command exiting 0 with stderr output reports success", () => {
    expect(runWrapper('cmd /c "echo banner 1>&2 & exit 0"')).toBe(0);
  });

  test("native command propagates a non-zero exit code", () => {
    expect(runWrapper('cmd /c "exit 3"')).toBe(3);
  });

  test("successful pure PowerShell command reports success", () => {
    expect(runWrapper("Get-Date | Out-Null")).toBe(0);
  });

  test("pure PowerShell Write-Error reports failure", () => {
    expect(runWrapper("Write-Error 'boom'")).toBe(1);
  });

  test("pure PowerShell cmdlet failure reports failure", () => {
    expect(runWrapper("Get-Item 'C:\\does-not-exist-xyz-impulse'")).toBe(1);
  });
});
