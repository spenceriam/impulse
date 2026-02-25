import { describe, expect, test } from "bun:test";
import { z } from "zod";
import "../src/tools/init";
import { Tool } from "../src/tools/registry";

describe("tool registry dynamic mode filtering", () => {
  test("unknown dynamic tools default to read_only visibility", () => {
    const dynamicToolName = `dynamic_read_only_${Date.now()}`;

    Tool.define(
      dynamicToolName,
      "dynamic read-only tool",
      z.object({}),
      async () => ({ success: true, output: "ok" })
    );

    const workDefs = Tool.getAPIDefinitionsForMode("WORK");
    const planDefs = Tool.getAPIDefinitionsForMode("PLAN");

    expect(workDefs.some((def) => def.function.name === dynamicToolName)).toBe(true);
    expect(planDefs.some((def) => def.function.name === dynamicToolName)).toBe(true);
  });

  test("set_mode remains available as a utility tool across modes", () => {
    const planDefs = Tool.getAPIDefinitionsForMode("PLAN");
    const exploreDefs = Tool.getAPIDefinitionsForMode("EXPLORE");

    expect(planDefs.some((def) => def.function.name === "set_mode")).toBe(true);
    expect(exploreDefs.some((def) => def.function.name === "set_mode")).toBe(true);
  });
});
