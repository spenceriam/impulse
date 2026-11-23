import { describe, expect, test } from "bun:test";
import {
  isPlannerTool,
  missingProviderRoles,
  ORCHESTRATOR_LABEL_MAX,
  orchestratorLabel,
  resolvePreset,
  shouldReplan,
  type OrchestratorConfig,
  type OrchestratorPreset,
} from "../src/agent/orchestrator.js";

const preset: OrchestratorPreset = {
  name: "default",
  planner: { model: "kilo/anthropic/claude-opus-5.5", reasoning: "high" },
  executor: { model: "ollama/glm-5.3", reasoning: "low" },
};

describe("orchestratorLabel (#221)", () => {
  test("wraps the short model name", () => {
    expect(orchestratorLabel("ollama/glm-5.3")).toBe("Orchestrator (glm-5.3)");
  });

  test("truncates past 20 characters with an ellipsis", () => {
    const long = "ollama/some-very-long-model-name-here";
    const label = orchestratorLabel(long);
    const inner = label.slice("Orchestrator (".length, -1);
    expect(inner.length).toBe(ORCHESTRATOR_LABEL_MAX + 1); // 20 chars + …
    expect(inner.endsWith("…")).toBe(true);
  });

  test("exactly 20 characters is not truncated", () => {
    const twenty = "a".repeat(20);
    expect(orchestratorLabel(twenty)).toBe(`Orchestrator (${twenty})`);
  });
});

describe("shouldReplan (#221)", () => {
  test("nothing to do when all is well", () => {
    expect(shouldReplan({ verificationFailures: 0 })).toBeNull();
  });

  test("verification failing twice returns control", () => {
    expect(shouldReplan({ verificationFailures: 1 })).toBeNull();
    expect(shouldReplan({ verificationFailures: 2 })).toBe("verification-failed-twice");
  });

  test("triggers are ordered: friction before the user", () => {
    expect(
      shouldReplan({
        verificationFailures: 2,
        interfaceUnexpected: true,
        userMessaged: true,
      })
    ).toBe("verification-failed-twice");
    expect(
      shouldReplan({ verificationFailures: 0, designUnsettled: true, userMessaged: true })
    ).toBe("unsettled-design");
    expect(shouldReplan({ verificationFailures: 0, userMessaged: true })).toBe("user-message");
  });
});

describe("planner tool scope (#221)", () => {
  test("planner is read-only", () => {
    expect(isPlannerTool("file_read")).toBe(true);
    expect(isPlannerTool("grep")).toBe(true);
    expect(isPlannerTool("file_edit")).toBe(false);
    expect(isPlannerTool("bash")).toBe(false);
    expect(isPlannerTool("task")).toBe(false);
  });
});

describe("resolvePreset (#221)", () => {
  const config: OrchestratorConfig = {
    enabled: true,
    activePreset: "default",
    presets: { default: preset, cheap: { ...preset, name: "cheap" } },
  };

  test("active preset by default, named on request", () => {
    expect(resolvePreset(config)?.name).toBe("default");
    expect(resolvePreset(config, "cheap")?.name).toBe("cheap");
  });

  test("unknown name or no config resolves to undefined", () => {
    expect(resolvePreset(config, "nope")).toBeUndefined();
    expect(resolvePreset(undefined)).toBeUndefined();
  });
});

describe("missingProviderRoles (#221)", () => {
  test("names each role whose provider has no key", () => {
    expect(missingProviderRoles(preset, (k) => k === "ollama")).toEqual(["planner"]);
    expect(missingProviderRoles(preset, () => true)).toEqual([]);
    expect(missingProviderRoles(preset, () => false)).toEqual(["planner", "executor"]);
  });
});
