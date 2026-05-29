/**
 * node-pty backend (loaded when native module is available).
 */

import type { ShellOutputEvent, PtyHandle } from "./index.js";

type PtyModule = typeof import("node-pty");

export async function loadPtyModule(): Promise<PtyModule | null> {
  try {
    return await import("node-pty");
  } catch {
    return null;
  }
}

export function spawnWithNodePty(
  pty: PtyModule,
  command: string,
  cwd: string,
  cols: number,
  rows: number,
  onEvent: (event: ShellOutputEvent) => void,
  signal?: AbortSignal
): PtyHandle {
  const shell = process.platform === "win32" ? "powershell.exe" : process.env['SHELL'] || "bash";
  const args =
    process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-Command", command]
      : ["-lc", command];

  const term = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: process.env as Record<string, string>,
  });

  let output = "";
  const abortListener = () => {
    try {
      term.kill();
    } catch {
      /* ignore */
    }
  };
  signal?.addEventListener("abort", abortListener, { once: true });

  term.onData((data) => {
    output += data;
    onEvent({ type: "data", output: data });
  });

  const result = new Promise<{ output: string; exitCode: number; pid?: number }>((resolve) => {
    term.onExit(({ exitCode }) => {
      signal?.removeEventListener("abort", abortListener);
      onEvent({ type: "exit", exitCode, output: "" });
      resolve({ output, exitCode: exitCode ?? 1, pid: term.pid });
    });
  });

  return {
    pid: term.pid,
    write: (data: string) => term.write(data),
    kill: () => {
      try {
        term.kill();
      } catch {
        /* ignore */
      }
    },
    result,
  };
}
