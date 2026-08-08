import { describe, expect, test } from "bun:test";
import { isToolAllowedForMode, Tool } from "../src/tools/registry.js";
import { userInstructionsTool } from "../src/tools/user-instructions.js";

describe("user_instructions tool", () => {
  test("is registered as a scoped write tool only in execution modes", () => {
    expect(Tool.get("user_instructions")).toBe(userInstructionsTool);
    expect(isToolAllowedForMode("user_instructions", "AGENT")).toBe(true);
    expect(isToolAllowedForMode("user_instructions", "DEBUG")).toBe(true);
    expect(isToolAllowedForMode("user_instructions", "EXPLORE")).toBe(false);
    expect(isToolAllowedForMode("user_instructions", "PLAN")).toBe(false);
  });

  test("documents explicit persistence intent and the single write target", () => {
    expect(userInstructionsTool.description).toContain("ONLY when the user explicitly asks");
    expect(userInstructionsTool.description).toContain("never writes anywhere else");
    expect(userInstructionsTool.description).toContain("~/.impulse/user-instructions.md");
  });

  test("rejects a mutating action without confirmed explicit intent", async () => {
    const result = await userInstructionsTool.handler({
      action: "replace",
      content: "Merely mentioned preference",
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("explicit user intent");
  });
});
