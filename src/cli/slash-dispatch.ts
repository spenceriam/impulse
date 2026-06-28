/**
 * Slash command dispatch table — extracted from ImpulseRenderer.handleSlash.
 */

import { resolveSlashAlias } from "./slash-aliases.js";

export interface SlashDispatchHost {
  readonly isRunning: boolean;
  cmdAdvisor(arg: string): Promise<void>;
  cmdExperimental(): Promise<void>;
  cmdSettings(): Promise<void>;
  showConfigAliasHint(): void;
  cmdUpdate(): Promise<void>;
  cmdModel(arg: string): Promise<void>;
  showVisionHint(): void;
  cmdMode(arg: string): void;
  showReasoningHint(): void;
  cmdUsage(): Promise<void>;
  cmdCheckpoint(): Promise<void>;
  cmdUndo(arg: string): Promise<void>;
  cmdRedo(arg: string): Promise<void>;
  cmdGoal(arg: string): Promise<void>;
  cmdAllowAll(arg: string): Promise<void>;
  showExpressRemovedHint(): void;
  cmdUser(arg: string): Promise<void>;
  cmdResume(arg: string): Promise<void>;
  toggleDebug(): void | Promise<void>;
  showSpeedoHint(): void;
  cmdNew(arg: string): Promise<void>;
  cmdClearScreen(): void;
  cmdShow(): Promise<void>;
  showHelpOverlay(): void;
  cmdSteer(arg: string): void;
  cmdCopy(): void | Promise<void>;
  cmdSide(arg: string): Promise<void>;
  showThinkingSettingsHint(): void;
  cmdCompact(): Promise<void>;
  gracefulExit(): Promise<void>;
  showUnknownSlash(cmd: string): void;
}

type SlashHandler = (host: SlashDispatchHost, arg: string) => void | Promise<void>;

const SLASH_DISPATCH: Record<string, SlashHandler> = {
  advisor: (h, arg) => h.cmdAdvisor(arg),
  experimental: (h) => h.cmdExperimental(),
  settings: (h) => h.cmdSettings(),
  config: (h) => h.showConfigAliasHint(),
  update: (h) => h.cmdUpdate(),
  model: (h, arg) => h.cmdModel(arg),
  vision: (h) => h.showVisionHint(),
  mode: (h, arg) => h.cmdMode(arg),
  reasoning: (h) => h.showReasoningHint(),
  reason: (h) => h.showReasoningHint(),
  think: (h) => h.showReasoningHint(),
  usage: (h) => h.cmdUsage(),
  checkpoint: (h) => h.cmdCheckpoint(),
  undo: (h, arg) => h.cmdUndo(arg),
  redo: (h, arg) => h.cmdRedo(arg),
  goal: (h, arg) => h.cmdGoal(arg),
  "allow-all": (h, arg) => h.cmdAllowAll(arg),
  express: (h) => h.showExpressRemovedHint(),
  engage: (h) => h.showExpressRemovedHint(),
  user: (h, arg) => h.cmdUser(arg),
  resume: (h, arg) => h.cmdResume(arg),
  sessions: (h, arg) => h.cmdResume(arg),
  debug: (h) => h.toggleDebug(),
  speedo: (h) => h.showSpeedoHint(),
  new: (h, arg) => h.cmdNew(arg),
  clear: (h) => h.cmdClearScreen(),
  show: (h) => h.cmdShow(),
  restore: (h) => h.cmdShow(),
  help: (h) => h.showHelpOverlay(),
  steer: (h, arg) => h.cmdSteer(arg),
  copy: (h) => h.cmdCopy(),
  side: (h, arg) => h.cmdSide(arg),
  "show-think": (h) => h.showThinkingSettingsHint(),
  "hide-think": (h) => h.showThinkingSettingsHint(),
  compact: (h) => h.cmdCompact(),
  quit: (h) => h.gracefulExit(),
  exit: (h) => h.gracefulExit(),
};

export function slashDispatchKeys(): string[] {
  return Object.keys(SLASH_DISPATCH).sort((a, b) => a.localeCompare(b));
}

/** Parse `/command args` into command slug and remainder. */
export function parseSlashInput(input: string): { cmd: string; arg: string } {
  const parts = input.slice(1).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? "";
  const arg = parts.slice(1).join(" ").trim();
  return { cmd, arg };
}

export async function dispatchSlashCommand(
  input: string,
  host: SlashDispatchHost
): Promise<void> {
  const { cmd: parsedCmd, arg } = parseSlashInput(input);
  const cmd = resolveSlashAlias(parsedCmd);
  const handler = SLASH_DISPATCH[cmd];
  if (handler) {
    await handler(host, arg);
    return;
  }
  host.showUnknownSlash(cmd);
}
