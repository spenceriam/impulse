import { describe, expect, test } from "bun:test";
import { analyzePowerShellChaining, translatePosixToPowerShell } from "../src/tools/posix-translation.js";

describe("translatePosixToPowerShell", () => {
  test("leaves ls unchanged because PowerShell already has an ls alias", () => {
    expect(translatePosixToPowerShell("ls -la")).toEqual({
      translated: "ls -la",
      wasTranslated: false,
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
    // -r isn't in grep's supported single-command flag set (recursive grep needs
    // full pipeline/shell semantics), so it's intentionally left untranslated.
    expect(translatePosixToPowerShell("grep -r my pattern src")).toEqual({
      translated: "grep -r my pattern src",
      wasTranslated: false,
    });
    // which only translates a single bare command name, not multiple arguments.
    expect(translatePosixToPowerShell("which git node")).toEqual({
      translated: "which git node",
      wasTranslated: false,
    });
  });

  test("translates cp -> Copy-Item, including recursive/force flags", () => {
    expect(translatePosixToPowerShell("cp -R src dst").translated).toBe(
      "Copy-Item -Recurse -Path 'src' -Destination 'dst'"
    );
    expect(translatePosixToPowerShell("cp -rf src dst").translated).toBe(
      "Copy-Item -Recurse -Force -Path 'src' -Destination 'dst'"
    );
    expect(translatePosixToPowerShell("cp src.txt dst.txt").translated).toBe(
      "Copy-Item -Path 'src.txt' -Destination 'dst.txt'"
    );
  });

  test("translates mv -> Move-Item, including the force flag", () => {
    expect(translatePosixToPowerShell("mv src dst").translated).toBe(
      "Move-Item -Path 'src' -Destination 'dst'"
    );
    expect(translatePosixToPowerShell("mv -f old.txt new.txt").translated).toBe(
      "Move-Item -Force -Path 'old.txt' -Destination 'new.txt'"
    );
  });

  test("translates a simple grep -> Select-String", () => {
    expect(translatePosixToPowerShell("grep pattern file.txt").translated).toBe(
      "Select-String -CaseSensitive -Pattern 'pattern' -Path 'file.txt'"
    );
    expect(translatePosixToPowerShell("grep -i pattern file.txt").translated).toBe(
      "Select-String -CaseSensitive:$false -Pattern 'pattern' -Path 'file.txt'"
    );
    expect(translatePosixToPowerShell("grep -v pattern file.txt").translated).toBe(
      "Select-String -CaseSensitive -NotMatch -Pattern 'pattern' -Path 'file.txt'"
    );
  });

  test("translates which for a single command name", () => {
    expect(translatePosixToPowerShell("which git").translated).toBe(
      "(Get-Command git -ErrorAction SilentlyContinue).Source"
    );
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
    expect(analyzePowerShellChaining("echo a && echo b", "powershell5")).toMatchObject({
      hasChainingOperator: true,
      isSupported: false,
    });
    expect(analyzePowerShellChaining("echo a && echo b", "powershell7")).toMatchObject({
      hasChainingOperator: true,
      isSupported: true,
    });
    expect(analyzePowerShellChaining('git commit -m "fix: a && b"', "powershell5").hasChainingOperator).toBe(false);
    expect(analyzePowerShellChaining("Select-String 'a || b' file.txt", "powershell5").hasChainingOperator).toBe(false);
  });
});
