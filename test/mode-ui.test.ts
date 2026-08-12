import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildSlashCommandDefs,
  cycleDisplayedMode,
  resolveModeCommand,
} from "../src/cli/slash-commands.js";
import { buildHelpContent } from "../src/cli/components/help-overlay.js";
import { ContextBarComponent } from "../src/cli/components/context-bar.js";
import { sessionTableCellsForTest } from "../src/cli/components/session-picker-overlay.js";
import { renderUxCapture } from "../src/cli/ux-capture.js";
import type { Session } from "../src/session/store.js";
import { stripAnsiAndMarkers } from "./helpers/gutter-assertions.js";
import {
  agentAuthorityError,
  explicitUserModeTransitionNotice,
  modelModeTransitionCommittedNotice,
  modeTransitionFailureNotice,
} from "../src/cli/mode-authority.js";

const options = {
  experimentalAdvisor: false,
  experimentalUndo: false,
  experimentalGoal: false,
};

function contextBar(mode: "ASK" | "AGENT"): string {
  const bar = new ContextBarComponent(
    {
      workerModel: "openai/gpt-5",
      impulseVersion: "1.10.0",
      contextTokens: 10_000,
      contextWindow: 100_000,
      mode,
      cwd: "/workspace/impulse",
      bottomBarVisual: "full",
    },
    { branch: () => "piece-1", now: () => new Date("2026-08-10T12:00:00Z") }
  );
  return stripAnsiAndMarkers(bar.render(120).join("\n"));
}

function legacySession(mode: string): Session {
  return {
    id: `session-${mode}`,
    name: `${mode} session`,
    projectID: "project",
    directory: "/workspace/impulse",
    created_at: "2026-08-10T12:00:00Z",
    updated_at: "2026-08-10T12:00:00Z",
    messages: [],
    mode,
    model: "openai/gpt-5",
    todos: [],
    context_window: 100_000,
    cost: 0,
  };
}

describe("two-mode UI", () => {
  test("direct mutating UI routes require AGENT authority", () => {
    for (const action of [
      "run shell commands",
      "kill or restart background jobs",
      "create, modify, or remove skills",
      "change persistent user instructions",
      "install updates",
      "create or restore project checkpoints",
      "change persistent goal state",
    ]) {
      expect(agentAuthorityError("ASK", action)).toBe(
        `${action} requires AGENT. Switch with /mode AGENT or Tab.`
      );
      expect(agentAuthorityError("AGENT", action)).toBeNull();
    }
  });

  test("/mode is explicit and Tab cycles only ASK and AGENT", () => {
    expect(resolveModeCommand("", "ASK")).toEqual({
      message: "mode: ASK | options: ASK | AGENT | Tab to cycle",
    });
    expect(resolveModeCommand("AGENT", "ASK")).toEqual({ nextMode: "AGENT" });
    expect(resolveModeCommand("ask", "AGENT")).toEqual({ nextMode: "ASK" });
    expect(resolveModeCommand("WORK", "ASK")).toEqual({
      error: "Unknown mode. Options: ASK | AGENT",
    });
    expect(resolveModeCommand("mystery", "AGENT")).toEqual({
      error: "Unknown mode. Options: ASK | AGENT",
    });

    expect(cycleDisplayedMode("ASK", 1)).toBe("AGENT");
    expect(cycleDisplayedMode("AGENT", 1)).toBe("ASK");
    expect(cycleDisplayedMode("ASK", -1)).toBe("AGENT");
  });

  test("Tab and /mode elevation emit an explicit authority notice even with the bar off", () => {
    const offBar = new ContextBarComponent({
      workerModel: "openai/gpt-5",
      impulseVersion: "1.10.0",
      contextTokens: 10_000,
      contextWindow: 100_000,
      mode: "AGENT",
      cwd: "/workspace/impulse",
      bottomBarVisual: "off",
    });
    expect(stripAnsiAndMarkers(offBar.render(120).join("\n")).trim()).toBe("");

    const tabMode = cycleDisplayedMode("ASK", 1);
    expect(explicitUserModeTransitionNotice("ASK", tabMode)).toBe(
      "Mode: ASK -> AGENT -- execution authority enabled"
    );

    const direct = resolveModeCommand("AGENT", "ASK");
    expect("nextMode" in direct).toBe(true);
    if ("nextMode" in direct) {
      expect(explicitUserModeTransitionNotice("ASK", direct.nextMode)).toBe(
        "Mode: ASK -> AGENT -- execution authority enabled"
      );
    }
    expect(explicitUserModeTransitionNotice("AGENT", "ASK")).toBe(
      "Mode: AGENT -> ASK -- read-only"
    );
  });

  test("Tab and /mode de-escalation share background revocation notices", () => {
    const tabMode = cycleDisplayedMode("AGENT", 1);
    const direct = resolveModeCommand("ASK", "AGENT");
    expect(tabMode).toBe("ASK");
    expect(direct).toEqual({ nextMode: "ASK" });
    expect(explicitUserModeTransitionNotice("AGENT", tabMode, 2)).toBe(
      "Mode: AGENT -> ASK -- read-only; stopped 2 bg jobs"
    );
    expect(explicitUserModeTransitionNotice("AGENT", tabMode, 0, 1)).toBe(
      "Mode: AGENT -> ASK -- read-only; stopped shell"
    );
    expect(explicitUserModeTransitionNotice("AGENT", tabMode, 1, 1)).toBe(
      "Mode: AGENT -> ASK -- read-only; stopped 1 bg job + shell"
    );
    expect(modeTransitionFailureNotice(0, ["bg-7"])).toBe(
      "Mode remains AGENT -- failed to stop bg-7"
    );
    expect(modeTransitionFailureNotice(1, ["bg-8"])).toBe(
      "Mode remains AGENT -- stopped 1 bg job; failed to stop bg-8"
    );
  });

  test("deferred model mode events distinguish pending completion from failure", () => {
    expect(modelModeTransitionCommittedNotice("AGENT", "ASK", "Research only")).toBe(
      "Mode: AGENT -> ASK -- read-only (Research only)"
    );
    expect(modeTransitionFailureNotice(0, ["agent-turn-7"])).toBe(
      "Mode remains AGENT -- failed to stop agent-turn-7"
    );
  });

  test("help, context bar, session picker, and captures advertise only ASK and AGENT", () => {
    const defs = buildSlashCommandDefs(options);
    const mode = defs.find((definition) => definition.cmd === "/mode");
    const debug = defs.find((definition) => definition.cmd === "/debug");
    expect(mode?.helpDetail).toBe("Change mode: ASK (default, read-only) or AGENT (execution)");
    expect(debug?.helpDetail).toBe("Toggle writing a session debug log file");

    const help = buildHelpContent(options, 76).map(stripAnsiAndMarkers).join("\n");
    expect(help).toContain("ASK (default) — read-only research, planning, and diagnosis");
    expect(help).toContain("AGENT — explicit execution authority");
    expect(help).not.toContain("EXPLORE —");
    expect(help).not.toContain("PLAN —");
    expect(help).not.toContain("DEBUG —");

    expect(contextBar("ASK")).toContain("ASK");
    expect(contextBar("AGENT")).toContain("AGENT");

    expect(sessionTableCellsForTest(legacySession("WORK")).mode).toBe("AGENT");
    expect(sessionTableCellsForTest(legacySession("PLAN")).mode).toBe("ASK");
    expect(sessionTableCellsForTest(legacySession("mystery")).mode).toBe("ASK");

    const capture = renderUxCapture()
      .flatMap((entry) => entry.scenarios.flatMap((scenario) => scenario.lines))
      .map(stripAnsiAndMarkers)
      .join("\n");
    expect(capture).toContain("ASK");
    expect(capture).not.toContain("EXPLORE —");
    expect(capture).not.toContain("PLAN —");
    expect(capture).not.toContain("DEBUG —");
  });

  test("public and agent-facing documentation advertises the two-mode contract", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");

    for (const document of [readme, agents]) {
      expect(document).toContain("ASK");
      expect(document).toContain("AGENT");
      expect(document).not.toContain("AGENT (default)");
      expect(document).not.toContain("**EXPLORE**");
      expect(document).not.toContain("**PLAN**");
      expect(document).not.toContain("**DEBUG**");
    }
    expect(readme).toContain("ASK (default, read-only)");
    expect(readme).toContain("Allow-All persists globally");
    expect(agents).toContain("ASK is the default");

    const runtimeToolDocs = [
      "set-mode.md",
      "task.md",
      "user-instructions.md",
      "plan-revision.md",
      "install-skill.md",
      "github-issue.md",
    ].map((name) => readFileSync(new URL(`../docs/tools/${name}`, import.meta.url), "utf8"));
    for (const document of runtimeToolDocs) {
      expect(document).not.toMatch(/\b(?:WORK|EXPLORE|PLAN|DEBUG|AUTO|PLANNER|PLAN-PRD)\b/);
    }
    expect(readme).not.toContain("Advisor mode");
  });
});
