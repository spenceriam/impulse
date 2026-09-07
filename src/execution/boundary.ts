import { lstat, realpath } from "fs/promises";
import { dirname, resolve } from "path";
import { isWithinBase } from "../util/path.js";
export interface ExecutionBoundaryDescriptor {
  kind: "host";
  label: "HOST";
  workspaceRoot: string;
  backend: "host";
  network: "host";
}

export interface BoundaryOwnedProcess {
  pid?: number;
  exited: Promise<number>;
  stdout?: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  kill(): Promise<void> | void;
}

export interface BoundaryRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BoundaryCleanupResult {
  ok: boolean;
  stopped: number;
  reason?: string;
}

export interface ExecutionBoundary {
  readonly descriptor: ExecutionBoundaryDescriptor;
  resolvePath(input: string, operation: "read" | "write"): Promise<string>;
  run(command: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<BoundaryRunResult>;
  cleanup(): Promise<BoundaryCleanupResult>;
}

type BoundarySpawn = (argv: string[], options: { cwd: string; env?: Record<string, string> }) => BoundaryOwnedProcess;

function defaultSpawn(argv: string[], options: { cwd: string; env?: Record<string, string> }): BoundaryOwnedProcess {
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    pid: proc.pid,
    exited: proc.exited,
    stdout: proc.stdout,
    stderr: proc.stderr,
    kill: () => { proc.kill(); },
  };
}

export function createHostExecutionBoundary(input: {
  workspaceRoot: string;
  additionalRoots?: string[];
  spawn?: BoundarySpawn;
}): ExecutionBoundary {
  const root = resolve(input.workspaceRoot);
  const roots = [root, ...(input.additionalRoots ?? []).map((entry) => resolve(entry))];
  const spawn = input.spawn ?? defaultSpawn;
  const owned = new Set<BoundaryOwnedProcess>();
  let closed = false;

  const resolveScopedPath = async (targetInput: string): Promise<string> => {
    const target = resolve(root, targetInput);
    const lexicalRoot = roots.find((candidate) => isAtOrWithin(candidate, target));
    if (!lexicalRoot) throw new BoundaryPathError(target, root);
    const canonicalRoot = await realpath(lexicalRoot);
    const existing = await nearestExistingPath(target);
    const canonicalExisting = await realpath(existing);
    if (!isAtOrWithin(canonicalRoot, canonicalExisting)) {
      throw new BoundaryPathError(target, canonicalRoot);
    }
    return target;
  };

  return {
    descriptor: {
      kind: "host",
      label: "HOST",
      workspaceRoot: root,
      backend: "host",
      network: "host",
    },
    resolvePath: (target) => resolveScopedPath(target),
    async run(command, options = {}) {
      if (closed) throw new Error("Host execution boundary is closed.");
      if (command.length === 0) throw new Error("Host command cannot be empty.");
      const cwd = await resolveScopedPath(options.cwd ?? root);
      const process = spawn(command, { cwd, ...(options.env ? { env: options.env } : {}) });
      owned.add(process);
      try {
        const stdout = process.stdout ? new Response(process.stdout).text() : Promise.resolve("");
        const stderr = process.stderr ? new Response(process.stderr).text() : Promise.resolve("");
        const [exitCode, out, err] = await Promise.all([process.exited, stdout, stderr]);
        return { exitCode, stdout: out, stderr: err };
      } finally {
        owned.delete(process);
      }
    },
    async cleanup() {
      if (closed && owned.size === 0) return { ok: true, stopped: 0 };
      closed = true;
      const processes = [...owned];
      const failures: string[] = [];
      await Promise.all(processes.map(async (process) => {
        try {
          await process.kill();
          await process.exited;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        } finally {
          owned.delete(process);
        }
      }));
      return failures.length === 0
        ? { ok: true, stopped: processes.length }
        : { ok: false, stopped: processes.length, reason: failures.join("; ") };
    },
  };
}

export class BoundaryPathError extends Error {
  constructor(readonly target: string, readonly root: string) {
    super(`Blocked path outside the workspace roots: ${target}`);
    this.name = "BoundaryPathError";
  }
}

function isAtOrWithin(root: string, target: string): boolean {
  return target === root || isWithinBase(root, target);
}

async function nearestExistingPath(target: string): Promise<string> {
  let current = target;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}
