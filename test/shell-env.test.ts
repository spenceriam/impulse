import { describe, expect, test } from "bun:test";
import { generateShellContext, type ShellEnvironment } from "../src/util/shell-env.js";

describe("generateShellContext", () => {
  test("uses bash command syntax when a non-bash login shell is detected on Unix", () => {
    const env: ShellEnvironment = {
      platform: "Linux",
      shell: "fish 3.6.1",
      shellVersion: "3.6.1",
      shellType: "fish",
      commandShell: "bash 5.2.15",
      commandShellType: "bash",
      supportsChainedCommands: true,
      commandSeparator: "&&",
      recommendations: [],
      tips: [],
    };

    const context = generateShellContext(env);

    expect(context).toContain("Login shell: fish 3.6.1 (fish)");
    expect(context).toContain("Command shell: bash 5.2.15 (bash, via bash -lc)");
    expect(context).toContain("Use && to chain commands");
    expect(context).not.toContain("Use 'and' to chain commands");
  });

  test("keeps PowerShell 5 guidance for Windows command execution", () => {
    const env: ShellEnvironment = {
      platform: "Windows",
      shell: "Windows PowerShell 5.x",
      shellVersion: "5.1.19041.1",
      shellType: "powershell5",
      commandShell: "Windows PowerShell 5.x",
      commandShellType: "powershell5",
      supportsChainedCommands: false,
      commandSeparator: ";",
      recommendations: [],
      tips: [],
    };

    const context = generateShellContext(env);

    expect(context).toContain("Shell: Windows PowerShell 5.x (powershell5)");
    expect(context).toContain("Use ; (semicolon) to chain commands, NOT &&");
    expect(context).toContain("POSIX commands are auto-translated");
  });
});
