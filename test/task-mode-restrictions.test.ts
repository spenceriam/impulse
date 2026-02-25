import { describe, expect, test } from "bun:test";
import "../src/tools/init";
import { Tool } from "../src/tools/registry";
import { setCurrentMode } from "../src/tools/mode-state";

describe("planning mode task restrictions", () => {
  test("PLAN exposes task tool with explore-only guidance", () => {
    const planDefs = Tool.getAPIDefinitionsForMode("PLAN");

    const planTask = planDefs.find((def) => def.function.name === "task");

    expect(planTask).toBeDefined();
    expect(planTask?.function.description).toContain("only subagent_type=\"explore\"");

    const planNames = planDefs.map((def) => def.function.name);

    expect(planNames).toContain("file_write");
    expect(planNames).not.toContain("bash");
    expect(planNames).not.toContain("file_edit");
  });

  test("PLAN rejects general subagent execution", async () => {
    setCurrentMode("PLAN");
    const planResult = await Tool.execute("task", {
      prompt: "Inspect docs for architecture references",
      description: "Plan mode test",
      subagent_type: "general",
    });

    expect(planResult.success).toBe(false);
    expect(planResult.output).toContain("only allows explore subagents");
  });
});

