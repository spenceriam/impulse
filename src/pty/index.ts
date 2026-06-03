/**
 * PTY support for interactive shell commands.
 */

import { loadPtyModule, spawnWithNodePty } from "./node-pty-impl.js";

export interface ShellOutputEvent {
  type: "data" | "exit" | "prompt_detected";
  output: string | Array<{ text: string }[]>;
  exitCode?: number;
  signal?: string;
  prompt?: string;
  suggestion?: string;
}

export interface PtyHandle {
  pid: number;
  write: (data: string) => void;
  kill: () => void;
  result: Promise<{ output: string; exitCode: number; pid?: number }>;
}

export interface PtySpawnOptions {
  shell?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

export const PtyEvents = {
  Output: "pty.output",
  PromptDetected: "pty.prompt_detected",
  Exited: "pty.exited",
  Started: "pty.started",
} as const;

let ptyModulePromise: ReturnType<typeof loadPtyModule> | null = null;
let ptyAvailable: boolean | null = null;

async function getPtyModule() {
  if (!ptyModulePromise) ptyModulePromise = loadPtyModule();
  return ptyModulePromise;
}

export async function probePtyAvailable(): Promise<boolean> {
  if (ptyAvailable !== null) return ptyAvailable;
  const mod = await getPtyModule();
  if (!mod) {
    ptyAvailable = false;
    return false;
  }
  try {
    const shell = "bash";
    const t = mod.spawn(shell, ["-c", "true"], {
      name: "xterm-256color",
      cols: 80,
      rows: 8,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
    await new Promise<void>((resolve) => {
      t.onExit(() => resolve());
      setTimeout(() => {
        try {
          t.kill();
        } catch {
          /* ignore */
        }
        resolve();
      }, 2000);
    });
    ptyAvailable = true;
  } catch {
    ptyAvailable = false;
  }
  return ptyAvailable;
}

export function isPtyAvailable(): boolean {
  return ptyAvailable === true;
}

export async function executePty(
  command: string,
  cwd: string,
  onEvent: (event: ShellOutputEvent) => void,
  signal?: AbortSignal,
  cols = 80,
  rows = 24,
  options?: PtySpawnOptions
): Promise<PtyHandle> {
  const mod = await getPtyModule();
  if (!mod) {
    throw new Error("PTY not available");
  }
  return spawnWithNodePty(mod, command, cwd, cols, rows, onEvent, signal, options);
}

/** Call once at startup to detect PTY (sets isPtyAvailable sync flag). */
export async function initPty(): Promise<void> {
  await probePtyAvailable();
}
