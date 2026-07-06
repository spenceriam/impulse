import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  dispatchSlashCommand,
  hydrateDynamicSkillCommands,
  listDynamicSkillCommands,
  unregisterSkillCommand,
  type SlashDispatchHost,
} from "../src/cli/slash-dispatch.js";

function createHost(calls: string[]): SlashDispatchHost {
  const record = (name: string, arg = "") => {
    calls.push(arg ? `${name}:${arg}` : name);
  };

  return {
    isRunning: false,
    cmdSkills: async (arg) => record("skills", arg),
    cmdSkill: async (arg) => record("skill", arg),
    cmdRunSkillCommand: async (slug, arg) => record(`run-skill:${slug}`, arg),
    cmdAdvisor: async (arg) => record("advisor", arg),
    cmdExperimental: async () => record("experimental"),
    cmdSettings: async () => record("settings"),
    showConfigAliasHint: () => record("config"),
    cmdUpdate: async () => record("update"),
    cmdModel: async (arg) => record("model", arg),
    showVisionHint: () => record("vision"),
    cmdMode: (arg) => record("mode", arg),
    showReasoningHint: () => record("reasoning"),
    cmdUsage: async () => record("usage"),
    cmdCheckpoint: async () => record("checkpoint"),
    cmdUndo: async (arg) => record("undo", arg),
    cmdRedo: async (arg) => record("redo", arg),
    cmdGoal: async (arg) => record("goal", arg),
    cmdAllowAll: async (arg) => record("allow-all", arg),
    showExpressRemovedHint: () => record("express"),
    cmdUser: async (arg) => record("user", arg),
    cmdResume: async (arg) => record("resume", arg),
    toggleDebug: () => record("debug"),
    showSpeedoHint: () => record("speedo"),
    cmdNew: async (arg) => record("new", arg),
    cmdClearScreen: () => record("clear"),
    cmdShow: async () => record("show"),
    showHelpOverlay: () => record("help"),
    cmdSteer: (arg) => record("steer", arg),
    cmdCopy: () => record("copy"),
    cmdSide: async (arg) => record("side", arg),
    showThinkingSettingsHint: () => record("thinking"),
    cmdCompact: async () => record("compact"),
    gracefulExit: async () => record("exit"),
    showUnknownSlash: (cmd) => record("unknown", cmd),
  };
}

describe("hydrateDynamicSkillCommands", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-skill-hydration-"));
  });

  afterEach(() => {
    unregisterSkillCommand("hydratetest");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("registers a command alias for a skill with a command: frontmatter field", async () => {
    const skillDir = path.join(tmp, ".agents", "skills", "hydrate-test");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: hydrate-test\ndescription: test skill\ncommand: hydratetest\n---\n\nBody.\n"
    );

    await hydrateDynamicSkillCommands(tmp);

    const entries = listDynamicSkillCommands();
    expect(entries).toContainEqual({ cmd: "hydratetest", slug: "hydrate-test" });
  });

  test("dispatch falls through to cmdRunSkillCommand for a hydrated command", async () => {
    const skillDir = path.join(tmp, ".agents", "skills", "hydrate-test");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: hydrate-test\ndescription: test skill\ncommand: hydratetest\n---\n\nBody.\n"
    );
    await hydrateDynamicSkillCommands(tmp);

    const calls: string[] = [];
    const host = createHost(calls);
    await dispatchSlashCommand("/hydratetest some args", host);

    expect(calls).toEqual(["run-skill:hydrate-test:some args"]);
  });

  test("is non-fatal when the .agents/skills directory doesn't exist", async () => {
    await expect(hydrateDynamicSkillCommands(path.join(tmp, "does-not-exist"))).resolves.toBeUndefined();
  });
});
