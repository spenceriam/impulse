import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Tool } from "../src/tools/registry.js";

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
});
