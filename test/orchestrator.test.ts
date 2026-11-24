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

import {
  formatPlanInjection,
  formatProgressReport,
  parsePlannerReply,
  PLANNER_SYSTEM_ADDENDUM,
} from "../src/agent/orchestrator-planner.js";

describe("parsePlannerReply (#221)", () => {
  test("a plan block is extracted, prose around it kept", () => {
    const { plan, prose } = parsePlannerReply(
      "Looking at this.\n<plan>\n1. Edit auth.ts\n2. Run bun test\n</plan>\nGood luck."
    );
    expect(plan).toBe("1. Edit auth.ts\n2. Run bun test");
    expect(prose).toContain("Looking at this.");
    expect(prose).toContain("Good luck.");
  });

  test("no block means a direct answer", () => {
    const { plan, prose } = parsePlannerReply("The config lives in src/util/config.ts.");
    expect(plan).toBeNull();
    expect(prose).toBe("The config lives in src/util/config.ts.");
  });

  test("an empty or unclosed block is not a plan", () => {
    expect(parsePlannerReply("<plan></plan>").plan).toBeNull();
    expect(parsePlannerReply("<plan>never closed").plan).toBeNull();
  });
});

describe("plan injection and progress (#221)", () => {
  test("first plan and revisions are labelled distinctly", () => {
    expect(formatPlanInjection("do x", 0)).toContain("Plan for this turn");
    expect(formatPlanInjection("do x", 1)).toContain("Revised plan (revision 2)");
  });

  test("progress report lists steps with failures called out", () => {
    const report = formatProgressReport([
      { tool: "file_read", ok: true },
      { tool: "bash", ok: false, note: "tests failed" },
    ]);
    expect(report).toContain("1. file_read — ok");
    expect(report).toContain("2. bash — FAILED: tests failed");
    expect(formatProgressReport([])).toContain("no steps executed yet");
  });

  test("the planner prompt forbids edits and requires re-plan triggers", () => {
    expect(PLANNER_SYSTEM_ADDENDUM).toContain("read-only");
    expect(PLANNER_SYSTEM_ADDENDUM).toContain("Re-plan triggers");
  });
});

import {
  buildOrchestratorRows,
  buildProviderGroupedRows,
  isOrchestratorRow,
  ORCHESTRATOR_ROW_PREFIX,
  orchestratorRowPreset,
} from "../src/cli/components/model-picker-overlay.js";
import type { Config } from "../src/util/config.js";

function configWith(orch: NonNullable<Config["orchestrator"]>): Config {
  return { orchestrator: orch } as Config;
}

describe("orchestrator picker rows (#221)", () => {
  const orch: NonNullable<Config["orchestrator"]> = {
    enabled: true,
    activePreset: "default",
    presets: {
      default: preset,
      cheap: {
        name: "cheap",
        planner: { model: "ollama/glm-5.3", reasoning: "medium" },
        executor: { model: "ollama/glm-5.3", reasoning: "low" },
      },
    },
  };

  test("no presets means no rows", () => {
    expect(buildOrchestratorRows(configWith({ enabled: true, activePreset: "x", presets: {} }))).toEqual([]);
  });

  test("the active preset is the first row, labelled Orchestrator (<planner>)", () => {
    const rows = buildOrchestratorRows(configWith(orch));
    expect(rows[0]!.label).toBe("Orchestrator (claude-opus-5.5)");
    expect(rows[0]!.metaRight).toBe("active");
    expect(orchestratorRowPreset(rows[0]!.id)).toBe("default");
  });

  test("other presets follow, each once", () => {
    const rows = buildOrchestratorRows(configWith(orch));
    expect(rows.map((r) => orchestratorRowPreset(r.id))).toEqual(["default", "cheap"]);
  });

  test("a disabled orchestrator shows the row without 'active'", () => {
    const rows = buildOrchestratorRows(configWith({ ...orch, enabled: false }));
    expect(rows[0]!.metaRight).toBe("");
  });

  test("row helpers round-trip and reject other rows", () => {
    const id = `${ORCHESTRATOR_ROW_PREFIX}cheap`;
    expect(isOrchestratorRow(id)).toBe(true);
    expect(orchestratorRowPreset(id)).toBe("cheap");
    expect(isOrchestratorRow("ollama\0glm-5.3")).toBe(false);
  });

  test("orchestrator rows come before provider groups", () => {
    const rows = buildProviderGroupedRows(
      [{ providerKey: "ollama", label: "Ollama Cloud", infos: [] }],
      undefined,
      buildOrchestratorRows(configWith(orch))
    );
    expect(isOrchestratorRow(rows[0]!.id)).toBe(true);
    expect(rows.some((r) => r.id === "__header__ollama")).toBe(true);
  });
});
