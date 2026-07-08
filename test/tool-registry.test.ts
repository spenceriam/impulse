import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Tool, isToolAllowedForMode } from "../src/tools/registry.js";
import { MODES } from "../src/constants.js";
import "../src/tools/ls.js";

describe("Tool.execute", () => {
  test("suggests close tool names for unknown tools", async () => {
    Tool.define(
      "sample_tool",
      "Sample tool for registry suggestion tests",
      z.object({}),
      async () => ({ success: true, output: "ok" })
    );

    const result = await Tool.execute("sample_tol", {});

    expect(result.success).toBe(false);
    expect(result.output).toContain("Tool not found: sample_tol");
    expect(result.output).toContain("Did you mean: sample_tool?");
    expect(result.output).toContain("Use tool_docs(list=true) to see all available tools.");
  });

  test("surfaces a repair note when input needed auto-repair (§2.1 transparency)", async () => {
    Tool.define(
      "sample_repair_tool",
      "Sample tool for repair-transparency tests",
      z.object({ offset: z.number().optional() }),
      async (input) => ({ success: true, output: `offset=${input.offset ?? "unset"}` })
    );

    // Z.AI-style optional-field mistake: null instead of omitting the key.
    const result = await Tool.execute("sample_repair_tool", { offset: null });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Note: your tool call arguments were auto-repaired");
    expect(result.output).toContain("offset: sent null on an optional field");
    expect(result.output).toContain("offset=unset");
  });

  test("does not prepend a repair note when input was already valid", async () => {
    Tool.define(
      "sample_valid_tool",
      "Sample tool for repair-transparency tests (valid input, no note)",
      z.object({ offset: z.number().optional() }),
      async (input) => ({ success: true, output: `offset=${input.offset ?? "unset"}` })
    );

    const result = await Tool.execute("sample_valid_tool", { offset: 5 });

    expect(result.success).toBe(true);
    expect(result.output).toBe("offset=5");
    expect(result.output).not.toContain("Note:");
  });
});

describe("ls tool mode allowlist", () => {
  test("is allowed in every mode, including read-only EXPLORE and PLAN", () => {
    for (const mode of MODES) {
      expect(isToolAllowedForMode("ls", mode)).toBe(true);
    }
  });
});
