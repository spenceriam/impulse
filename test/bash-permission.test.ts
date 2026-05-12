import { describe, expect, test } from "bun:test";
import { classifyCommand, needsPermission } from "../src/tools/bash";

const CWD = process.platform === "win32" ? "C:/repo/project" : "/repo/project";

describe("bash permission heuristics", () => {
  test("allows read-only directory listing", () => {
    expect(classifyCommand("ls")).toBe("safe");
    expect(needsPermission("ls", CWD)).toEqual({ needed: false });
  });

  test("allows benign mkdir in cwd", () => {
    expect(classifyCommand("mkdir -p test-temp-smoke")).toBe("safe");
    expect(needsPermission("mkdir -p test-temp-smoke", CWD)).toEqual({ needed: false });
  });

  test("allows unknown commands within cwd by default", () => {
    expect(classifyCommand("custom-tool --check ./src")).toBe("unknown");
    expect(needsPermission("custom-tool --check ./src", CWD)).toEqual({ needed: false });
  });

  test("blocks high-risk destructive commands", () => {
    expect(classifyCommand("rm -rf test-temp-smoke")).toBe("high_risk");
    expect(needsPermission("rm -rf test-temp-smoke", CWD)).toEqual({
      needed: true,
      reason: "High-risk command",
    });
  });

  test("blocks commands that escape the working directory", () => {
    expect(needsPermission("mkdir ../outside-folder", CWD)).toEqual({
      needed: true,
      reason: "Path outside working directory: ../outside-folder",
    });
  });

  test("treats PowerShell file inspection as safe", () => {
    expect(classifyCommand("Get-ChildItem .\\src")).toBe("safe");
    expect(needsPermission("Get-ChildItem .\\src", CWD)).toEqual({ needed: false });
  });

  test("does not flag Format-Table search output as destructive", () => {
    const command = 'Select-String -Path "C:\\repo\\project\\temp_test\\*" -Pattern "ERROR|WARN|INFO" | Format-Table -AutoSize';
    expect(classifyCommand(command)).toBe("safe");
    expect(needsPermission(command, CWD)).toEqual({ needed: false });
  });
});
