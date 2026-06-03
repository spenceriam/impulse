import { describe, expect, test } from "bun:test";
import { detectPowerShellVersion, translatePosixToPowerShell } from "../src/tools/posix-translation.js";

describe("translatePosixToPowerShell", () => {
  test("translates ls flags without requiring a path", () => {
    expect(translatePosixToPowerShell("ls -la")).toEqual({
      translated: "Get-ChildItem -Force -Path '.'",
      wasTranslated: true,
      rule: "ls -> Get-ChildItem",
    });
  });

  test("preserves rm semantics for interactive and recursive flags", () => {
    expect(translatePosixToPowerShell("rm -i file.txt").translated).toBe(
      "Remove-Item -Confirm -Path 'file.txt'"
    );
    expect(translatePosixToPowerShell("rm -rf build").translated).toBe(
      "Remove-Item -Recurse -Force -Path 'build'"
    );
    expect(translatePosixToPowerShell("rm -R build").translated).toBe(
      "Remove-Item -Recurse -Path 'build'"
    );
  });

  test("captures repeated flags for grep, cp, and mv", () => {
    expect(translatePosixToPowerShell("grep -r -i TODO src").translated).toBe(
      "Select-String -Pattern 'TODO' -Recurse -Path 'src'"
    );
    expect(translatePosixToPowerShell("cp -R src dst").translated).toBe(
      "Copy-Item -Recurse -Path 'src' -Destination 'dst'"
    );
    expect(translatePosixToPowerShell("mv -f src dst").translated).toBe(
      "Move-Item -Force -Path 'src' -Destination 'dst'"
    );
  });

  test("quotes translated path arguments", () => {
    expect(translatePosixToPowerShell("cat my file.txt").translated).toBe(
      "Get-Content -Path 'my file.txt'"
    );
    expect(translatePosixToPowerShell("touch Bob's notes.txt").translated).toBe(
      "New-Item -ItemType File -Force -Path 'Bob''s notes.txt'"
    );
  });

  test("does not partially translate pipelines or redirects", () => {
    expect(translatePosixToPowerShell("ls -la | grep package")).toEqual({
      translated: "ls -la | grep package",
      wasTranslated: false,
    });
    expect(translatePosixToPowerShell('echo "data" > file.txt')).toEqual({
      translated: 'echo "data" > file.txt',
      wasTranslated: false,
    });
  });

  test("keeps echo pipeline-compatible when translated", () => {
    expect(translatePosixToPowerShell("echo value").translated).toBe("Write-Output value");
  });

  test("detects only unquoted PowerShell chaining operators", () => {
    expect(detectPowerShellVersion("echo a && echo b").hasChainingOperator).toBe(true);
    expect(detectPowerShellVersion('git commit -m "fix: a && b"').hasChainingOperator).toBe(false);
    expect(detectPowerShellVersion("Select-String 'a || b' file.txt").hasChainingOperator).toBe(false);
  });
});
