import { describe, expect, test } from "bun:test";
import {
  canonicalizeSlashAliasInput,
  SLASH_ALIASES,
} from "../src/cli/slash-aliases.js";
import {
  dispatchSlashCommand,
  slashDispatchKeys,
  type SlashDispatchHost,
} from "../src/cli/slash-dispatch.js";
import {
  completeSlashCommandTab,
  shouldShowSlashAutocomplete,
} from "../src/cli/slash-autocomplete.js";
import { buildSlashCommandList } from "../src/cli/slash-commands.js";

function createHost(calls: string[]): SlashDispatchHost {
  const record = (name: string, arg = "") => {
    calls.push(arg ? `${name}:${arg}` : name);
  };

  return {
    isRunning: false,
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

describe("slash aliases", () => {
  test("canonicalizes exact alias slash tokens and preserves args", () => {
    expect(canonicalizeSlashAliasInput("/aa")).toBe("/allow-all");
    expect(canonicalizeSlashAliasInput("/aa   ")).toBe("/allow-all   ");
    expect(canonicalizeSlashAliasInput("/aa anything")).toBe("/allow-all anything");
    expect(canonicalizeSlashAliasInput("  /AA anything")).toBe("  /allow-all anything");
    expect(canonicalizeSlashAliasInput("/mdl glm-4.7")).toBe("/model glm-4.7");
    expect(canonicalizeSlashAliasInput("/unknown arg")).toBe("/unknown arg");
    expect(canonicalizeSlashAliasInput("not /aa")).toBe("not /aa");
  });

  test("aliases are unique and do not shadow canonical dispatch keys", () => {
    const aliases = Object.keys(SLASH_ALIASES);
    const targets = Object.values(SLASH_ALIASES);
    const dispatchKeys = slashDispatchKeys();

    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases.filter((alias) => dispatchKeys.includes(alias))).toEqual([]);
    expect(targets.filter((target) => !dispatchKeys.includes(target))).toEqual([]);
  });

  test("dispatch resolves representative aliases and preserves args", async () => {
    const calls: string[] = [];
    const host = createHost(calls);

    await dispatchSlashCommand("/aa on", host);
    await dispatchSlashCommand("/h", host);
    await dispatchSlashCommand("/mdl glm-4.7", host);
    await dispatchSlashCommand("/ss", host);
    await dispatchSlashCommand("/rst", host);
    await dispatchSlashCommand("/sh", host);
    await dispatchSlashCommand("/q", host);

    expect(calls).toEqual([
      "allow-all:on",
      "help",
      "model:glm-4.7",
      "resume",
      "show",
      "show",
      "exit",
    ]);
  });

  test("canonical and alias dispatch paths are equivalent", async () => {
    const aliasCalls: string[] = [];
    const canonicalCalls: string[] = [];

    await dispatchSlashCommand(canonicalizeSlashAliasInput("/aa"), createHost(aliasCalls));
    await dispatchSlashCommand("/allow-all", createHost(canonicalCalls));
    expect(aliasCalls).toEqual(canonicalCalls);

    const aliasArgCalls: string[] = [];
    const canonicalArgCalls: string[] = [];
    await dispatchSlashCommand(canonicalizeSlashAliasInput("/aa arg"), createHost(aliasArgCalls));
    await dispatchSlashCommand("/allow-all arg", createHost(canonicalArgCalls));
    expect(aliasArgCalls).toEqual(canonicalArgCalls);
  });

  test("overlapping aliases dispatch distinctly", async () => {
    const calls: string[] = [];
    const host = createHost(calls);

    await dispatchSlashCommand("/ex", host);
    await dispatchSlashCommand("/exp", host);
    await dispatchSlashCommand("/rs", host);
    await dispatchSlashCommand("/rst", host);

    expect(calls).toEqual(["exit", "experimental", "resume", "show"]);
  });

  test("Tab expands exact aliases to canonical commands without adding alias rows", () => {
    const commands = buildSlashCommandList({
      experimentalAdvisor: true,
      experimentalUndo: true,
      experimentalGoal: true,
    });

    expect(completeSlashCommandTab("/aa", commands, null).text).toBe("/allow-all");
    expect(completeSlashCommandTab("  /AA now", commands, null).text).toBe(
      "  /allow-all now"
    );
    expect(completeSlashCommandTab("/mdl glm-4.7", commands, null).text).toBe(
      "/model glm-4.7"
    );
    expect(completeSlashCommandTab("/rs", commands, null).text).toBe("/resume");
    expect(completeSlashCommandTab("/rst", commands, null).text).toBe("/restore");
    expect(completeSlashCommandTab("/ex", commands, null).text).toBe("/exit");
    expect(completeSlashCommandTab("/exp", commands, null).text).toBe("/experimental");
  });

  test("autocomplete suggests canonical command for exact aliases", () => {
    const commands = buildSlashCommandList({
      experimentalAdvisor: true,
      experimentalUndo: true,
      experimentalGoal: true,
    });

    const result = shouldShowSlashAutocomplete("/aa", commands);
    expect(result.show).toBe(true);
    expect(result.matches.map((m) => m.cmd)).toEqual(["/allow-all"]);
  });
});
