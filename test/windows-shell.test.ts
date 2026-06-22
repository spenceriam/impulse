import { describe, expect, test } from "bun:test";
import { resolveWindowsShellFromSignals } from "../src/util/windows-shell.js";

describe("resolveWindowsShellFromSignals", () => {
  test("detects PowerShell 7 from process tree", () => {
    const shell = resolveWindowsShellFromSignals({
      processTree: [{ name: "pwsh.exe", executablePath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" }],
      pwshPath: "pwsh",
      powershellPath: "powershell.exe",
    });

    expect(shell?.type).toBe("powershell7");
    expect(shell?.supportsChainedCommands).toBe(true);
  });

  test("detects Windows PowerShell from process tree", () => {
    const shell = resolveWindowsShellFromSignals({
      processTree: [{ name: "powershell.exe" }],
      pwshPath: "pwsh",
      powershellPath: "powershell.exe",
    });

    expect(shell?.type).toBe("powershell5");
    expect(shell?.supportsChainedCommands).toBe(false);
  });

  test("detects cmd from process tree", () => {
    const shell = resolveWindowsShellFromSignals({
      env: { COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
      processTree: [{ name: "cmd.exe" }],
      pwshPath: "pwsh",
      powershellPath: "powershell.exe",
    });

    expect(shell?.type).toBe("cmd");
    expect(shell?.executable).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  test("detects Git Bash from environment", () => {
    const shell = resolveWindowsShellFromSignals({
      env: {
        SHELL: "C:\\Program Files\\Git\\bin\\bash.exe",
        MSYSTEM: "MINGW64",
      },
      pwshPath: "pwsh",
      powershellPath: "powershell.exe",
    });

    expect(shell?.type).toBe("git-bash");
  });

  test("falls back to PowerShell 7 then Windows PowerShell", () => {
    expect(
      resolveWindowsShellFromSignals({
        pwshPath: "pwsh",
        powershellPath: "powershell.exe",
      })?.type
    ).toBe("powershell7");

    expect(
      resolveWindowsShellFromSignals({
        pwshPath: null,
        powershellPath: "powershell.exe",
      })?.type
    ).toBe("powershell5");
  });
});
