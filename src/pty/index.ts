/**
 * PTY stub — interactive PTY support disabled in CLI mode.
 * isPtyAvailable() always returns false so bash.ts falls back to spawn.
 * The types here satisfy bash.ts's imports; the functions are never called.
 */

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

export const PtyEvents = {
  Output:         "pty.output",
  PromptDetected: "pty.prompt_detected",
  Exited:         "pty.exited",
  Started:        "pty.started",
} as const;

/** Always false — CLI mode uses spawn fallback exclusively. */
export function isPtyAvailable(): boolean {
  return false;
}

/** Dead code — never reached because isPtyAvailable() === false. */
export async function executePty(
  _command: string,
  _cwd: string,
  _onEvent: (event: ShellOutputEvent) => void,
  _signal?: AbortSignal
): Promise<PtyHandle> {
  throw new Error("PTY not available in CLI mode");
}
