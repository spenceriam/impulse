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

let activeAbort: AbortController | null = null;
let activePty: PtyHandle | null = null;
let activeProc: ReturnType<typeof Bun.spawn> | null = null;

export function abortUserShell(): void {
  activeAbort?.abort();
  activePty?.kill();
  if (activeProc) {
    try {
      activeProc.kill();
    } catch {
      /* ignore */
    }
    activeProc = null;
  }
  activeAbort = null;
  activePty = null;
}

export function writeToUserShell(data: string): void {
  if (activePty) {
    activePty.write(data);
    return;
  }
  const stdin = activeProc?.stdin;
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
  const command = options.command.trim();
  const cwd = options.cwd ? sanitizePath(options.cwd) : process.cwd();
  const start = Date.now();
  const interactive = options.forceInteractive ?? needsInteractiveMode(command);
  const builtCommand = await buildCmd(command, interactive);

  abortUserShell();
  activeAbort = new AbortController();
  const { signal } = activeAbort;

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
    activePty = handle;
    let result: ShellRunResult;
    try {
      const ptyResult = await handle.result;
      activePty = null;
      activeAbort = null;
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
      activePty = null;
      activeAbort = null;
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
  const proc = Bun.spawn({
    cmd: builtCommand.cmd,
    cwd,
    env: process.env,
    stdin: usePipedInteractive ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  activeProc = proc;

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
  activeProc = null;
  activeAbort = null;

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
