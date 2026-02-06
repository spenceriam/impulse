import { describe, expect, test } from "bun:test";
import "../src/tools/init";
import { Tool } from "../src/tools/registry";
import { resetAutoApproval, setCurrentMode } from "../src/tools/mode-state";

describe("planning mode task restrictions", () => {
  test("PLANNER and PLAN-PRD expose task tool with explore-only guidance", () => {
    const plannerDefs = Tool.getAPIDefinitionsForMode("PLANNER");
    const planPrdDefs = Tool.getAPIDefinitionsForMode("PLAN-PRD");

    const plannerTask = plannerDefs.find((def) => def.function.name === "task");
    const planPrdTask = planPrdDefs.find((def) => def.function.name === "task");

    expect(plannerTask).toBeDefined();
    expect(planPrdTask).toBeDefined();
    expect(plannerTask?.function.description).toContain("only subagent_type=\"explore\"");
    expect(planPrdTask?.function.description).toContain("only subagent_type=\"explore\"");

    const plannerNames = plannerDefs.map((def) => def.function.name);
    const planPrdNames = planPrdDefs.map((def) => def.function.name);

    expect(plannerNames).toContain("file_write");
    expect(planPrdNames).toContain("file_write");
    expect(plannerNames).not.toContain("bash");
    expect(plannerNames).not.toContain("file_edit");
    expect(planPrdNames).not.toContain("bash");
    expect(planPrdNames).not.toContain("file_edit");
  });

  test("planning modes reject general subagent execution", async () => {
    resetAutoApproval();
    setCurrentMode("PLANNER");
    const plannerResult = await Tool.execute("task", {
      prompt: "Inspect docs for architecture references",
      description: "Planner test",
      subagent_type: "general",
    });

    expect(plannerResult.success).toBe(false);
    expect(plannerResult.output).toContain("only allows explore subagents");

    setCurrentMode("PLAN-PRD");
    const planPrdResult = await Tool.execute("task", {
      prompt: "Inspect docs for architecture references",
      description: "Plan-prd test",
      subagent_type: "general",
    });

    expect(planPrdResult.success).toBe(false);
    expect(planPrdResult.output).toContain("only allows explore subagents");
  });
});

