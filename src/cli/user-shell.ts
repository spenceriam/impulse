/**
 * User-initiated shell commands (! shell mode) — no permission prompts.
 */

import { sanitizePath } from "../util/path.js";
import {
  executePty,
  isPtyAvailable,
  initPty,
  type PtyHandle,
  type PtySpawnOptions,
} from "../pty/index.js";
import { needsInteractiveMode } from "../tools/bash.js";
import { detectAndPublishBranchChange } from "../git/branch-detect.js";
import { detectWindowsCommandShell } from "../util/windows-shell.js";
import { killProcessTree, killProcessTreeSync } from "../util/process-tree.js";
import { registerExecutionStart } from "../tools/execution-admission.js";

export interface ShellRunResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  output: string;
  exitCode: number;
  success: boolean;
  durationMs: number;
}

export type ShellDataHandler = (chunk: string) => void;

interface BuiltShellCommand {
  cmd: string[];
  ptyOptions?: PtySpawnOptions;
}

async function buildCmd(command: string, interactive = false): Promise<BuiltShellCommand> {
  if (process.platform === "win32") {
    const shell = await detectWindowsCommandShell();

    if (shell.type === "cmd") {
      const args = ["/d", "/s", "/c", command];
      return { cmd: [shell.executable, ...args], ptyOptions: { shell: shell.executable, args } };
    }

    if (shell.type === "git-bash") {
      const args = ["-lc", command];
      return { cmd: [shell.executable, ...args], ptyOptions: { shell: shell.executable, args } };
    }

    const args = [
      "-NoLogo",
      "-NoProfile",
      ...(interactive ? [] : ["-NonInteractive"]),
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ];
    return { cmd: [shell.executable, ...args], ptyOptions: { shell: shell.executable, args } };
  }

  const args = ["-lc", command];
  return { cmd: ["bash", ...args], ptyOptions: { shell: "bash", args } };
}

interface ActiveUserShell {
  pid: number;
  abort: AbortController;
  pty: PtyHandle | null;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminationPromise: Promise<boolean> | null;
}

export interface UserShellRevocationResult {
  stoppedShells: number;
  failedParticipantIds: string[];
}

const USER_SHELL_PARTICIPANT_ID = "user-shell";
let activeShell: ActiveUserShell | null = null;

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function confirmProcessStopped(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isProcessRunning(pid);
}

function clearActiveShell(shell: ActiveUserShell): void {
  if (activeShell === shell) activeShell = null;
}

export function isUserShellActive(): boolean {
  return activeShell !== null;
}

/** Stop the active ! shell tree and clear ownership only after PID exit confirmation. */
export async function revokeActiveUserShell(): Promise<UserShellRevocationResult> {
  const shell = activeShell;
  if (!shell) return { stoppedShells: 0, failedParticipantIds: [] };

  if (!shell.terminationPromise) {
    shell.terminationPromise = (async () => {
      await killProcessTree(shell.pid);
      const confirmed = await confirmProcessStopped(shell.pid);
      if (!confirmed) return false;

      shell.abort.abort();
      shell.pty?.kill();
      clearActiveShell(shell);
      return true;
    })();
  }

  const confirmed = await shell.terminationPromise;
  if (!confirmed) {
    shell.terminationPromise = null;
    return { stoppedShells: 0, failedParticipantIds: [USER_SHELL_PARTICIPANT_ID] };
  }
  return { stoppedShells: 1, failedParticipantIds: [] };
}

export async function abortUserShell(): Promise<boolean> {
  const result = await revokeActiveUserShell();
  return result.failedParticipantIds.length === 0;
}

/** Last-resort process-exit cleanup; normal renderer exits use awaited cleanup. */
export function cleanupActiveUserShellSync(): void {
  const shell = activeShell;
  if (!shell) return;
  try {
    killProcessTreeSync(shell.pid);
  } catch {
    /* process is already exiting */
  }
  shell.abort.abort();
  shell.pty?.kill();
  clearActiveShell(shell);
}

export function writeToUserShell(data: string): void {
  if (activeShell?.pty) {
    activeShell.pty.write(data);
    return;
  }
  const stdin = activeShell?.proc?.stdin;
  if (stdin && typeof stdin === "object" && "write" in stdin) {
    (stdin as { write: (d: string) => void }).write(data);
  }
}

export async function ensurePtyReady(): Promise<boolean> {
  if (isPtyAvailable()) return true;
  await initPty();
  return isPtyAvailable();
}

export async function runUserShellCommand(options: {
  command: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  onData: ShellDataHandler;
  forceInteractive?: boolean;
}): Promise<ShellRunResult> {
  const activeAbort = new AbortController();
  const admission = registerExecutionStart("user-shell", () => activeAbort.abort());
  if (!admission.accepted) {
    throw new Error("Execution is paused while authority or lifecycle cleanup is changing.");
  }
  try {
    return await runAdmittedUserShellCommand(options, activeAbort);
  } finally {
    admission.complete();
  }
}

async function runAdmittedUserShellCommand(options: {
  command: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  onData: ShellDataHandler;
  forceInteractive?: boolean;
}, activeAbort: AbortController): Promise<ShellRunResult> {
  const command = options.command.trim();
  const cwd = options.cwd ? sanitizePath(options.cwd) : process.cwd();
  const start = Date.now();
  const interactive = options.forceInteractive ?? needsInteractiveMode(command);
  const builtCommand = await buildCmd(command, interactive);
  if (activeAbort.signal.aborted) {
    throw new Error("Shell start cancelled during execution cleanup.");
  }

  if (!(await abortUserShell())) {
    throw new Error("Failed to stop the previous user shell process.");
  }
  const { signal } = activeAbort;
  if (signal.aborted) {
    throw new Error("Shell start cancelled during execution cleanup.");
  }

  let combined = "";

  const append = (chunk: string) => {
    combined += chunk;
    options.onData(chunk);
  };

  if (interactive && (await ensurePtyReady())) {
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    const handle = await executePty(
      command,
      cwd,
      (ev) => {
        if (ev.type === "data" && typeof ev.output === "string") {
          append(ev.output);
        }
      },
      signal,
      cols,
      rows,
      builtCommand.ptyOptions
    );
    if (signal.aborted) {
      await killProcessTree(handle.pid);
      await handle.result.catch(() => {});
      throw new Error("Shell start cancelled during execution cleanup.");
    }
    const shell: ActiveUserShell = {
      pid: handle.pid,
      abort: activeAbort,
      pty: handle,
      proc: null,
      terminationPromise: null,
    };
    activeShell = shell;
    let result: ShellRunResult;
    try {
      const ptyResult = await handle.result;
      clearActiveShell(shell);
      const durationMs = Date.now() - start;
      result = {
        command,
        cwd,
        stdout: ptyResult.output,
        stderr: "",
        output: ptyResult.output || "(no output)",
        exitCode: ptyResult.exitCode,
        success: ptyResult.exitCode === 0,
        durationMs,
      };
    } catch (e) {
      clearActiveShell(shell);
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        command,
        cwd,
        stdout: "",
        stderr: msg,
        output: msg,
        exitCode: -1,
        success: false,
        durationMs: Date.now() - start,
      };
    }

    if (result.success) {
      detectAndPublishBranchChange(command, cwd);
    }
    return result;
  }

  const usePipedInteractive = interactive && !isPtyAvailable();
  if (signal.aborted) {
    throw new Error("Shell start cancelled during execution cleanup.");
  }
  const proc = Bun.spawn({
    cmd: builtCommand.cmd,
    cwd,
    env: process.env,
    stdin: usePipedInteractive ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const shell: ActiveUserShell = {
    pid: proc.pid,
    abort: activeAbort,
    pty: null,
    proc,
    terminationPromise: null,
  };
  activeShell = shell;

  const readStream = async (stream: ReadableStream<Uint8Array> | null | undefined) => {
    if (!stream) return "";
    const text = await new Response(stream).text();
    if (text) append(text);
    return text;
  };

  signal.addEventListener(
    "abort",
    () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
    { once: true }
  );

  const stdoutP = readStream(proc.stdout);
  const stderrP = readStream(proc.stderr);
  const exitCode = await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);
  clearActiveShell(shell);

  const output = combined || [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";
  const durationMs = Date.now() - start;
  const result = {
    command,
    cwd,
    stdout,
    stderr,
    output,
    exitCode,
    success: exitCode === 0,
    durationMs,
  };

  if (result.success) {
    detectAndPublishBranchChange(command, cwd);
  }
  return result;
}
