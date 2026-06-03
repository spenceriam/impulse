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
    expect(translatePosixToPowerShell("rm old.txt").translated).toBe(
      "Remove-Item -Path 'old.txt'"
    );
    expect(translatePosixToPowerShell("rm -rf")).toEqual({
      translated: "rm -rf",
      wasTranslated: false,
    });
  });

  test("leaves complex command families unchanged", () => {
    expect(translatePosixToPowerShell("grep -r my pattern src")).toEqual({
      translated: "grep -r my pattern src",
      wasTranslated: false,
    });
    expect(translatePosixToPowerShell("which git node")).toEqual({
      translated: "which git node",
      wasTranslated: false,
    });
    expect(translatePosixToPowerShell("cp -R src dst")).toEqual({
      translated: "cp -R src dst",
      wasTranslated: false,
    });
    expect(translatePosixToPowerShell("mv src dst")).toEqual({
      translated: "mv src dst",
      wasTranslated: false,
    });
  });

  test("quotes translated path arguments", () => {
    expect(translatePosixToPowerShell('cat "my file.txt"').translated).toBe(
      "Get-Content -Path 'my file.txt'"
    );
    expect(translatePosixToPowerShell('touch "Bob\'s notes.txt"').translated).toBe(
      "New-Item -ItemType File -Force -Path 'Bob''s notes.txt'"
    );
  });

  test("preserves multiple path arguments", () => {
    expect(translatePosixToPowerShell("mkdir -p dir1 dir2").translated).toBe(
      "New-Item -ItemType Directory -Force -Path 'dir1', 'dir2'"
    );
    expect(translatePosixToPowerShell("cat file1 file2").translated).toBe(
      "Get-Content -Path 'file1', 'file2'"
    );
  });

  test("does not partially translate pipelines or redirects", () => {
    expect(translatePosixToPowerShell("ls -la | grep package")).toEqual({
      translated: "ls -la | grep package",
      wasTranslated: false,
    });
    expect(translatePosixToPowerShell("echo a & echo b")).toEqual({
      translated: "echo a & echo b",
      wasTranslated: false,
    });
    expect(translatePosixToPowerShell('echo "data" > file.txt')).toEqual({
      translated: 'echo "data" > file.txt',
      wasTranslated: false,
    });
  });

  test("leaves echo unchanged because PowerShell already supports it", () => {
    expect(translatePosixToPowerShell("echo value")).toEqual({
      translated: "echo value",
      wasTranslated: false,
    });
  });

  test("counts lines using Measure-Object", () => {
    expect(translatePosixToPowerShell("wc -l file.txt").translated).toBe(
      "(Get-Content -Path 'file.txt' | Measure-Object -Line).Lines"
    );
  });

  test("detects only unquoted PowerShell chaining operators", () => {
    expect(detectPowerShellVersion("echo a && echo b").hasChainingOperator).toBe(true);
    expect(detectPowerShellVersion('git commit -m "fix: a && b"').hasChainingOperator).toBe(false);
    expect(detectPowerShellVersion("Select-String 'a || b' file.txt").hasChainingOperator).toBe(false);
  });
});
