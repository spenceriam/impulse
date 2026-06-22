import { describe, expect, test } from "bun:test";
import { classifyCommand, needsPermission } from "../src/tools/bash.js";

describe("bash permission policy", () => {
  test("unknown commands require approval", () => {
    expect(classifyCommand("mystery-cli --foo")).toBe("unknown");
    expect(needsPermission("mystery-cli --foo").needed).toBe(true);
  });

  test("safe read-only commands within cwd do not require approval", () => {
    expect(needsPermission("ls -la").needed).toBe(false);
  });

  test("compound commands classify each segment", () => {
    expect(needsPermission("git status && git diff -- src").needed).toBe(false);
    expect(needsPermission("echo ok; rm -rf build").needed).toBe(true);
    expect(needsPermission("echo ok && mystery-cli --foo").needed).toBe(true);
  });

  test("quoted operators do not make a command compound", () => {
    expect(needsPermission('echo "a && b"').needed).toBe(false);
    expect(needsPermission("Select-String 'a || b' file.txt").needed).toBe(false);
  });

  test("redirection requires approval", () => {
    expect(needsPermission("echo data > file.txt").needed).toBe(true);
  });
});
