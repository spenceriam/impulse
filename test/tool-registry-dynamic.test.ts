import { describe, expect, test } from "bun:test";
import { z } from "zod";
import "../src/tools/init";
import { Tool } from "../src/tools/registry";
import { resetAutoApproval } from "../src/tools/mode-state";

describe("tool registry dynamic mode filtering", () => {
  test("unknown dynamic tools default to read_only visibility", () => {
    const dynamicToolName = `dynamic_read_only_${Date.now()}`;

    Tool.define(
      dynamicToolName,
      "dynamic read-only tool",
      z.object({}),
      async () => ({ success: true, output: "ok" })
    );

    const autoDefs = Tool.getAPIDefinitionsForMode("AUTO");
    const plannerDefs = Tool.getAPIDefinitionsForMode("PLANNER");

    expect(autoDefs.some((def) => def.function.name === dynamicToolName)).toBe(true);
    expect(plannerDefs.some((def) => def.function.name === dynamicToolName)).toBe(true);
  });

  test("set_mode remains available as a utility tool across modes", () => {
    resetAutoApproval();
    const plannerDefs = Tool.getAPIDefinitionsForMode("PLANNER");
    const exploreDefs = Tool.getAPIDefinitionsForMode("EXPLORE");

    expect(plannerDefs.some((def) => def.function.name === "set_mode")).toBe(true);
    expect(exploreDefs.some((def) => def.function.name === "set_mode")).toBe(true);
  });
});
