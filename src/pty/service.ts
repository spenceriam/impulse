/**
 * PTY Service - Interactive Terminal Management
 * 
 * Provides pseudo-terminal (PTY) support for interactive shell commands.
 * Based on Gemini CLI's architecture using node-pty + @xterm/headless.
 */

import os from "node:os";

// Types for node-pty (declare manually due to package.json exports issue)
interface IPty {
  pid: number;
  cols: number;
  rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitData: { exitCode: number; signal?: number }) => void): void;
}

interface NodePtyModule {
  spawn(
    shell: string,
    args: string[],
    options: {
      cwd: string;
      name: string;
      cols: number;
      rows: number;
      env: Record<string, string | undefined>;
    }
  ): IPty;
}

// Dynamic import for node-pty (may not be available on all platforms)
let nodePty: NodePtyModule | null = null;
let Terminal: typeof import("@xterm/headless").Terminal | null = null;

/**
 * Initialize PTY dependencies (async to handle optional deps)
 */
export async function initPty(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodePty = (await import("@lydell/node-pty")) as any;
    const xterm = await import("@xterm/headless");
    Terminal = xterm.Terminal;
    return true;
  } catch (error) {
    console.error("PTY initialization failed:", error);
    return false;
  }
}

/**
 * Check if PTY is available
 */
export function isPtyAvailable(): boolean {
  return nodePty !== null && Terminal !== null;
}

/**
 * ANSI token for terminal output
 */
export interface AnsiToken {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * Line of ANSI tokens
 */
export type AnsiLine = AnsiToken[];

/**
 * Full terminal output as 2D array
 */
export type AnsiOutput = AnsiLine[];

/**
 * Shell output event types
 */
export type ShellOutputEvent =
  | { type: "data"; output: string | AnsiOutput }
  | { type: "prompt_detected"; prompt: string; suggestion: string | undefined }
  | { type: "binary_detected" }
  | { type: "binary_progress"; bytesReceived: number }
  | { type: "exit"; exitCode: number; signal: number | undefined };

/**
 * PTY execution result
 */
export interface PtyResult {
  output: string;
  exitCode: number;
  signal: number | undefined;
  aborted: boolean;
  pid: number | undefined;
}

/**
 * PTY execution handle for tracking running processes
 */
export interface PtyHandle {
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
  result: Promise<PtyResult>;
}

/**
 * Active PTY sessions
 */
interface ActivePty {
  ptyProcess: IPty;
  headlessTerminal: import("@xterm/headless").Terminal;
  outputBuffer: string;
}

const activePtys = new Map<number, ActivePty>();

/**
 * Get shell configuration based on platform
 */
function getShellConfig(): { shell: string; args: string[] } {
  if (os.platform() === "win32") {
    return { shell: "powershell.exe", args: ["-NoProfile", "-Command"] };
  }
  return { shell: "bash", args: ["-c"] };
}

/**
 * Execute command with PTY support
 */
export async function executePty(
  command: string,
  cwd: string,
  onEvent: (event: ShellOutputEvent) => void,
  signal: AbortSignal,
  options: {
    cols?: number;
    rows?: number;
    showColor?: boolean;
  } = {}
): Promise<PtyHandle> {
  if (!nodePty || !Terminal) {
    throw new Error("PTY not initialized. Call initPty() first.");
  }

  const { shell, args } = getShellConfig();
  const cols = options.cols ?? 120;
  const rows = options.rows ?? 30;

  const ptyProcess = nodePty.spawn(shell, [...args, command], {
    cwd,
    name: "xterm-256color",
    cols,
    rows,
    env: {
      ...process.env,
      IMPULSE_CLI: "1",
      TERM: "xterm-256color",
      PAGER: "cat",
      GIT_PAGER: "cat",
    },
  });

  const headlessTerminal = new Terminal({
    allowProposedApi: true,
    cols,
    rows,
    scrollback: 10000,
  });

  activePtys.set(ptyProcess.pid, {
    ptyProcess,
    headlessTerminal,
    outputBuffer: "",
  });

  let exited = false;

  const result = new Promise<PtyResult>((resolve) => {
    // Handle output
    ptyProcess.onData((data: string) => {
      // Write to headless terminal for parsing
      headlessTerminal.write(data, () => {
        // Emit event with current output
        const output = getTerminalText(headlessTerminal);
        onEvent({ type: "data", output });
        
        // Check for interactive prompts
        const promptMatch = detectInteractivePrompt(output);
        if (promptMatch) {
          onEvent({
            type: "prompt_detected",
            prompt: promptMatch.prompt,
            suggestion: promptMatch.suggestion,
          });
        }
      });
    });

    // Handle exit
    ptyProcess.onExit(({ exitCode, signal: sig }: { exitCode: number; signal?: number }) => {
      exited = true;
      activePtys.delete(ptyProcess.pid);
      
      const finalOutput = getTerminalText(headlessTerminal);
      onEvent({ type: "exit", exitCode, signal: sig });
      
      resolve({
        output: finalOutput,
        exitCode,
        signal: sig,
        aborted: signal.aborted,
        pid: ptyProcess.pid,
      });
    });

    // Handle abort
    const abortHandler = () => {
      if (!exited) {
        try {
          if (os.platform() === "win32") {
            ptyProcess.kill();
          } else {
            // Kill process group
            process.kill(-ptyProcess.pid, "SIGTERM");
            setTimeout(() => {
              if (!exited) {
                process.kill(-ptyProcess.pid, "SIGKILL");
              }
            }, 200);
          }
        } catch {
          ptyProcess.kill();
        }
      }
    };

    signal.addEventListener("abort", abortHandler, { once: true });
  });

  return {
    pid: ptyProcess.pid,
    write: (data: string) => {
      if (!exited && activePtys.has(ptyProcess.pid)) {
        ptyProcess.write(data);
      }
    },
    resize: (newCols: number, newRows: number) => {
      if (!exited && activePtys.has(ptyProcess.pid)) {
        try {
          ptyProcess.resize(newCols, newRows);
          headlessTerminal.resize(newCols, newRows);
        } catch {
          // Ignore resize errors on exited processes
        }
      }
    },
    kill: (sig = "SIGTERM") => {
      if (!exited) {
        ptyProcess.kill(sig);
      }
    },
    result,
  };
}

/**
 * Get text content from headless terminal
 */
function getTerminalText(terminal: import("@xterm/headless").Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    
    // Handle line wrapping
    const trimRight = !(i + 1 < buffer.length && buffer.getLine(i + 1)?.isWrapped);
    const lineContent = line.translateToString(trimRight);
    
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += lineContent;
    } else {
      lines.push(lineContent);
    }
  }
  
  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  
  return lines.join("\n");
}

/**
 * Interactive prompt patterns
 */
interface PromptMatch {
  prompt: string;
  suggestion?: string | undefined;
}

/**
 * Detect interactive prompts in terminal output
 */
function detectInteractivePrompt(output: string): PromptMatch | null {
  const lastLines = output.split("\n").slice(-5).join("\n").toLowerCase();
  
  // Y/N prompts
  if (/\[y\/n\]|\(y\/n\)|yes\/no|proceed\?/i.test(lastLines)) {
    // Try to determine default or suggested answer
    if (/\[Y\/n\]/i.test(lastLines)) {
      return { prompt: "y/n", suggestion: "y" };
    }
    if (/\[y\/N\]/i.test(lastLines)) {
      return { prompt: "y/n", suggestion: "n" };
    }
    return { prompt: "y/n", suggestion: undefined };
  }
  
  // Password prompts
  if (/password:|passphrase:|enter password/i.test(lastLines)) {
    return { prompt: "password", suggestion: undefined };
  }
  
  // Sudo prompts
  if (/\[sudo\]|password for/i.test(lastLines)) {
    return { prompt: "sudo", suggestion: undefined };
  }
  
  // Continue prompts
  if (/press enter|press any key|continue\?/i.test(lastLines)) {
    return { prompt: "continue", suggestion: "\n" };
  }
  
  // Choice prompts (numbered options)
  if (/\[1\].*\[2\]|select.*option|choose.*:/i.test(lastLines)) {
    return { prompt: "choice", suggestion: undefined };
  }
  
  return null;
}

/**
 * Write to active PTY by PID
 */
export function writeToPty(pid: number, data: string): boolean {
  const active = activePtys.get(pid);
  if (active) {
    active.ptyProcess.write(data);
    return true;
  }
  return false;
}

/**
 * Resize active PTY by PID
 */
export function resizePty(pid: number, cols: number, rows: number): boolean {
  const active = activePtys.get(pid);
  if (active) {
    try {
      active.ptyProcess.resize(cols, rows);
      active.headlessTerminal.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Check if PTY is still active
 */
export function isPtyActive(pid: number): boolean {
  return activePtys.has(pid);
}

/**
 * Get list of active PTY PIDs
 */
export function getActivePtys(): number[] {
  return Array.from(activePtys.keys());
}

/**
 * Bus events for PTY system
 */
export const PtyEvents = {
  /** PTY process started */
  Started: "pty.started",
  /** PTY output received */
  Output: "pty.output",
  /** Interactive prompt detected */
  PromptDetected: "pty.prompt",
  /** PTY process exited */
  Exited: "pty.exited",
  /** User wants to focus a PTY */
  Focus: "pty.focus",
  /** User input to focused PTY */
  Input: "pty.input",
} as const;
