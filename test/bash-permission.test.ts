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
});
