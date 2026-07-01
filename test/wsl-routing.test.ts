import { describe, expect, test } from "bun:test";
import { resolvePreferredShell, translateToWslPath } from "../src/tools/bash.js";

describe("translateToWslPath", () => {
  test("translates a C: drive path to /mnt/c/...", () => {
    expect(translateToWslPath("C:\\Users\\foo\\bar")).toBe("/mnt/c/Users/foo/bar");
  });

  test("translates a non-C drive letter, lowercased", () => {
    expect(translateToWslPath("D:\\projects\\repo")).toBe("/mnt/d/projects/repo");
  });

  test("passes through an already-POSIX path unchanged (other than separators)", () => {
    expect(translateToWslPath("/mnt/c/Users/foo")).toBe("/mnt/c/Users/foo");
    expect(translateToWslPath("/home/foo/project")).toBe("/home/foo/project");
  });

  test("throws a clear error for a UNC path instead of producing a broken /mnt path", () => {
    expect(() => translateToWslPath("\\\\server\\share\\folder")).toThrow(/UNC path/);
  });

  test("throws for a forward-slash UNC-style path too", () => {
    expect(() => translateToWslPath("//server/share/folder")).toThrow(/UNC path/);
  });
});

describe("resolvePreferredShell", () => {
  test("falls back to auto-detection for an unrecognized preference", async () => {
    // "auto" isn't handled explicitly inside resolvePreferredShell (the caller
    // branches on "auto" before calling it), so any unknown string should still
    // resolve to a real shell via the auto-detect fallback rather than throwing.
    const shell = await resolvePreferredShell("not-a-real-shell");
    expect(shell.type).toBeDefined();
    expect(shell.executable).toBeTruthy();
  });

  test("resolves cmd from COMSPEC or a sane default", async () => {
    const shell = await resolvePreferredShell("cmd");
    expect(shell.type).toBe("cmd");
    expect(shell.executable.toLowerCase()).toContain("cmd.exe");
  });

  test("resolves powershell to Windows PowerShell 5.x", async () => {
    const shell = await resolvePreferredShell("powershell");
    expect(shell.type).toBe("powershell5");
    expect(shell.supportsChainedCommands).toBe(false);
  });
});
