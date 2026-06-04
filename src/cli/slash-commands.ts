/**
 * Slash command registry for autocomplete and help.
 */

import type { SlashCommandEntry } from "./slash-autocomplete.js";

export interface SlashCommandDef {
  cmd: string;
  hint: string;
  helpDetail?: string;
}

export interface BuildSlashCommandsOptions {
  experimentalAdvisor: boolean;
  reasoningLevelsLabel: string;
}

function sortByCmd(a: SlashCommandDef, b: SlashCommandDef): number {
  return a.cmd.localeCompare(b.cmd);
}

/** Full command definitions (sorted by cmd). */
export function buildSlashCommandDefs(
  opts: BuildSlashCommandsOptions
): SlashCommandDef[] {
  const defs: SlashCommandDef[] = [
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
      cmd: "/debug",
      hint: "toggle session debug log file",
      helpDetail: "Toggle writing a session debug log file",
    },
    {
      cmd: "/exit",
      hint: "end impulse (alias /quit)",
      helpDetail: "End this impulse instance (alias /quit)",
    },
    {
      cmd: "/experimental",
      hint: "toggle experimental features such as advisor",
      helpDetail: "Toggle experimental features such as advisor",
    },
    {
      cmd: "/help",
      hint: "show help overlay",
      helpDetail: "Show this help overlay",
    },
    {
      cmd: "/model",
      hint: "choose or change model; set up provider via API key and endpoint",
      helpDetail:
        "Choose or change the worker model; change provider or add one with an API key and endpoint",
    },
    {
      cmd: "/mode",
      hint: "change agent mode (AGENT, EXPLORE, PLAN, DEBUG)",
      helpDetail:
        "Change mode: AGENT (default, full tools), EXPLORE (read-only), PLAN (plan only), DEBUG (debug workflow)",
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
      cmd: "/reasoning",
      hint: "set reasoning level for the worker model",
      helpDetail: `Set reasoning level (${opts.reasoningLevelsLabel}); same as in /model setup`,
    },
    {
      cmd: "/resume",
      hint: "browse and resume saved sessions",
      helpDetail: "Browse and resume a saved session",
    },
    {
      cmd: "/settings",
      hint: "thinking visibility and subagent model",
      helpDetail:
        "Show thinking in main agent or subagents; optional separate subagent model (/config alias)",
    },
    {
      cmd: "/config",
      hint: "alias for /settings",
      helpDetail: "Open settings overlay (alias for /settings)",
    },
    {
      cmd: "/show",
      hint: "restore chat view from session history",
      helpDetail: "Restore the on-screen chat from session history",
    },
    {
      cmd: "/show-think",
      hint: "expand collapsed Thought for… blocks in chat",
      helpDetail:
        "Expand collapsed main-agent thinking blocks in the current chat (live and restored sessions)",
    },
    {
      cmd: "/hide-think",
      hint: "collapse thinking blocks to Thought for…",
      helpDetail: "Collapse expanded thinking blocks back to one-line Thought for… summaries",
    },
    {
      cmd: "/side",
      hint: "side prompt during active turn; --history to review",
      helpDetail:
        "Ask a isolated clarification while the main agent is working (no tools). Use -c for main-chat context. /side --history to review past side prompts. Copy into main chat with C in the overlay.",
    },
    {
      cmd: "/steer",
      hint: "steer the current turn",
      helpDetail:
        "Inject steering instructions before the model's next action in the current turn",
    },
    {
      cmd: "/speedo",
      hint: "toggle turn tk/s and elapsed time",
      helpDetail: "Toggle to show turn tokens/second speed and total elasped turn time",
    },
    {
      cmd: "/update",
      hint: "check and install latest release",
      helpDetail: "Check for and install the latest release",
    },
    {
      cmd: "/user",
      hint: "view or update profile and preferences",
      helpDetail: "View or update your profile and preferences",
    },
    {
      cmd: "/vision",
      hint: "toggle vision mode; pick a vision model (same or different provider)",
      helpDetail:
        "Toggle vision mode and pick a vision model from the same or a different API provider",
    },
  ];

  if (opts.experimentalAdvisor) {
    defs.push({
      cmd: "/advisor",
      hint: "on | off | <model>  set advisor model",
      helpDetail: "Enable, disable, or set the advisor model (experimental)",
    });
  }

  return defs.sort(sortByCmd);
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
