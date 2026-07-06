import { describe, expect, test } from "bun:test";
import { classifyCommandError } from "../src/tools/bash.js";

describe("classifyCommandError", () => {
  test("returns null on a successful exit", () => {
    expect(classifyCommandError("foo", "anything", 0, "bash")).toBeNull();
  });

  test("PowerShell: recognizes a cmdlet-not-found error", () => {
    const hint = classifyCommandError(
      "grep foo",
      "grep : The term 'grep' is not recognized as the name of a cmdlet, function, script file, or operable program.",
      1,
      "powershell"
    );
    expect(hint).toContain("'grep' is not a recognised PowerShell cmdlet");
  });

  test("PowerShell: recognizes CommandNotFoundException", () => {
    const hint = classifyCommandError("jq", "CommandNotFoundException", 1, "powershell");
    expect(hint).toContain("'jq' is not a recognised PowerShell cmdlet");
  });

  test("cmd: recognizes an internal/external command failure", () => {
    const hint = classifyCommandError(
      "curl example.com",
      "'curl' is not recognized as an internal or external command,",
      1,
      "cmd"
    );
    expect(hint).toContain("'curl' was not found");
  });

  test("bash: recognizes command-not-found via message and exit code 127", () => {
    const byMessage = classifyCommandError("foobarbaz", "bash: foobarbaz: command not found", 127, "bash");
    expect(byMessage).toContain("'foobarbaz' was not found on PATH");

    const byExitCode = classifyCommandError("foobarbaz", "", 127, "bash");
    expect(byExitCode).toContain("'foobarbaz' was not found on PATH");
  });

  test("bash: recognizes permission-denied via message and exit code 126", () => {
    const hint = classifyCommandError("./script.sh", "Permission denied", 126, "bash");
    expect(hint).toContain("Permission denied executing './script.sh'");
  });

  test("bash: returns null when the output doesn't match a known pattern", () => {
    expect(classifyCommandError("foo", "some other failure", 2, "bash")).toBeNull();
  });

  test("uses only the first whitespace-delimited token as the command name", () => {
    const hint = classifyCommandError("some-tool --flag value", "command not found", 127, "bash");
    expect(hint).toContain("'some-tool' was not found on PATH");
  });
});
