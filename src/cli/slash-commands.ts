/**
 * Slash command registry for autocomplete and help.
 */

import type { SlashCommandEntry } from "./slash-autocomplete.js";

export interface SlashCommandDef {
  cmd: string;
  hint: string;
  helpDetail?: string;
  /** Omit from core /help overlay when true */
  hidden?: boolean;
}

export interface BuildSlashCommandsOptions {
  experimentalAdvisor: boolean;
  experimentalUndo: boolean;
  experimentalGoal: boolean;
}

function sortByCmd(a: SlashCommandDef, b: SlashCommandDef): number {
  return a.cmd.localeCompare(b.cmd);
}

/** Core command definitions (~15) plus experimental/hidden power-user entries. */
export function buildSlashCommandDefs(
  opts: BuildSlashCommandsOptions
): SlashCommandDef[] {
  const defs: SlashCommandDef[] = [
    {
      cmd: "/skills",
      hint: "list installed skills",
      helpDetail: "List all installed agent skills in this project",
    },
    {
      cmd: "/skill",
      hint: "new | remove | modify <slug>",
      helpDetail: "Create a new skill, remove an existing one, or modify it",
    },
    {
      cmd: "/ba",
      hint: "list or manage background jobs",
      helpDetail: "List background jobs (/ba), kill one (/ba kill <id>), or restart (/ba restart <id>)",
    },
    {
      cmd: "/allow-all",
      hint: "toggle bypass all permission prompts",
      helpDetail: "Toggle bypassing all tool permission prompts (session-only)",
    },
    {
      cmd: "/clear",
      hint: "clear on-screen chat (history kept)",
      helpDetail: "Clear the chat view; session history is preserved",
    },
    {
      cmd: "/compact",
      hint: "summarize older messages to free context",
      helpDetail: "Manually trigger context compaction to reduce token usage",
    },
    {
      cmd: "/exit",
      hint: "end impulse (alias /quit)",
      helpDetail: "End this impulse instance (alias /quit)",
    },
    {
      cmd: "/experimental",
      hint: "toggle experimental features",
      helpDetail: "Toggle experimental features (advisor, undo, goal loop)",
    },
    {
      cmd: "/help",
      hint: "show help overlay",
      helpDetail: "Show core commands and shortcuts",
    },
    {
      cmd: "/instructions",
      hint: "view | replace | append | import | clear",
      helpDetail: "Manage persistent user instructions with multiline paste or @path import",
    },
    {
      cmd: "/model",
      hint: "choose or change model",
      helpDetail: "Choose or change the worker model; configure provider API key and endpoint",
    },
    {
      cmd: "/mode",
      hint: "change agent mode",
      helpDetail: "Change mode: AGENT (default), EXPLORE, PLAN, DEBUG",
    },
    {
      cmd: "/new",
      hint: "start a new impulse session",
      helpDetail: "Start a new impulse session",
    },
    {
      cmd: "/quit",
      hint: "end impulse (alias /exit)",
      helpDetail: "End this impulse instance (alias /exit)",
    },
    {
      cmd: "/resume",
      hint: "browse and resume saved sessions",
      helpDetail: "Browse and resume a saved session in this project",
    },
    {
      cmd: "/sessions",
      hint: "alias for /resume",
      helpDetail: "Alias for /resume — sessions saved in this project (cwd)",
    },
    {
      cmd: "/restore",
      hint: "restore chat view from session history",
      helpDetail: "Restore the on-screen chat from session history (alias /show)",
    },
    {
      cmd: "/settings",
      hint: "thinking, subagent model, communication style",
      helpDetail: "Thinking display, subagent model, communication style, stats on exit",
    },
    {
      cmd: "/steer",
      hint: "steer the current turn",
      helpDetail: "Inject steering instructions before the model's next action in the current turn",
    },
    {
      cmd: "/update",
      hint: "check and install latest release",
      helpDetail: "Check for and install the latest release; resumes this session after install",
    },
    {
      cmd: "/usage",
      hint: "session tokens and provider quota",
      helpDetail: "Session usage stats and provider quota when available",
    },
    {
      cmd: "/user",
      hint: "view or update profile",
      helpDetail: "Display name and free-text preferences",
    },
    // Hidden power-user commands (work when typed, omitted from core /help)
    {
      cmd: "/debug",
      hint: "toggle session debug log file",
      helpDetail: "Toggle writing a session debug log file",
      hidden: true,
    },
    {
      cmd: "/side",
      hint: "side prompt during active turn",
      helpDetail: "Isolated clarification while the main agent is working. /side --history for past side prompts.",
      hidden: true,
    },
    {
      cmd: "/copy",
      hint: "copy last response to clipboard",
      helpDetail: "Copy the last assistant response (gutter-free markdown) via OSC 52 / native clipboard",
      hidden: true,
    },
    {
      cmd: "/show",
      hint: "alias for /restore",
      helpDetail: "Alias for /restore",
      hidden: true,
    },
  ];

  if (opts.experimentalAdvisor) {
    defs.push({
      cmd: "/advisor",
      hint: "on | off | <model>",
      helpDetail: "Enable, disable, or set the advisor model (experimental)",
      hidden: true,
    });
  }

  if (opts.experimentalUndo) {
    defs.push(
      {
        cmd: "/checkpoint",
        hint: "snapshot git + chat state",
        helpDetail: "Create a git checkpoint at the current message index (experimental)",
        hidden: true,
      },
      {
        cmd: "/undo",
        hint: "revert git + chat to checkpoint",
        helpDetail: "Revert working tree and trim chat to prior checkpoint (experimental)",
        hidden: true,
      },
      {
        cmd: "/redo",
        hint: "reapply checkpoint",
        helpDetail: "Reapply a later checkpoint (experimental)",
        hidden: true,
      }
    );
  }

  if (opts.experimentalGoal) {
    defs.push({
      cmd: "/goal",
      hint: "Hermes-style goal loop",
      helpDetail: "Start or manage an autonomous goal loop (experimental)",
      hidden: true,
    });
  }

  return defs.sort(sortByCmd);
}

/** Commands shown in the core /help overlay. */
export function buildCoreSlashCommandDefs(
  opts: BuildSlashCommandsOptions
): SlashCommandDef[] {
  return buildSlashCommandDefs(opts).filter((d) => !d.hidden);
}

/** Autocomplete entries (sorted). */
export function buildSlashCommandList(
  opts: BuildSlashCommandsOptions
): SlashCommandEntry[] {
  return buildSlashCommandDefs(opts).map((d) => ({
    cmd: d.cmd,
    hint: d.hint,
  }));
}
