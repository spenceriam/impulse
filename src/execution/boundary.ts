import { lstat, realpath } from "fs/promises";
import { dirname, join, relative, resolve, sep } from "path";
import { isWithinBase } from "../util/path.js";

export type ExecutionBoundaryKind = "host" | "workspace-sandbox" | "isolated-preview";
export type BoundaryNetwork = "host" | "off";

export interface ExecutionBoundaryDescriptor {
  kind: ExecutionBoundaryKind;
  label: "HOST" | "SANDBOX" | "PREVIEW";
  workspaceRoot: string;
  backend: "host" | "bubblewrap";
  network: BoundaryNetwork;
}

export interface BoundaryCapability {
  available: boolean;
  backend: "bubblewrap";
  executable?: string;
  reason?: string;
  remediation?: string;
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

export class BoundaryUnavailableError extends Error {
  constructor(
    message: string,
    readonly capability: BoundaryCapability
  ) {
    super(message);
    this.name = "BoundaryUnavailableError";
  }
}

export class BoundaryPathError extends Error {
  constructor(readonly target: string, readonly root: string) {
    super(`Blocked path outside preview workspace: ${target}`);
    this.name = "BoundaryPathError";
  }
}

function isAtOrWithin(root: string, target: string): boolean {
  return target === root || isWithinBase(root, target);
}

export interface BubblewrapProbeDependencies {
  platform?: NodeJS.Platform;
  findExecutable?: (name: string) => Promise<string | null>;
  runProbe?: (argv: string[]) => Promise<{ exitCode: number; stderr: string }>;
}

function remediation(): string {
  return "Install bubblewrap and enable unprivileged user namespaces, or explicitly switch to AGENT for host execution.";
}

async function defaultFindExecutable(name: string): Promise<string | null> {
  return Bun.which(name);
}

async function defaultRunProbe(argv: string[]): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stderr };
}

export async function probeBubblewrap(
  deps: BubblewrapProbeDependencies = {}
): Promise<BoundaryCapability> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "linux") {
    return {
      available: false,
      backend: "bubblewrap",
      reason: `No enforceable isolated-preview backend is available on ${platform}.`,
      remediation: remediation(),
    };
  }

  const executable = await (deps.findExecutable ?? defaultFindExecutable)("bwrap");
  if (!executable) {
    return {
      available: false,
      backend: "bubblewrap",
      reason: "bubblewrap was not found on PATH.",
      remediation: remediation(),
    };
  }

  const probeCommand = buildBubblewrapCommand({
    executable,
    workspaceRoot: "/tmp",
    command: ["/bin/true"],
  });
  try {
    const result = await (deps.runProbe ?? defaultRunProbe)(probeCommand);
    if (result.exitCode !== 0) {
      return {
        available: false,
        backend: "bubblewrap",
        executable,
        reason: result.stderr.trim() || `bubblewrap capability probe exited ${result.exitCode}.`,
        remediation: remediation(),
      };
    }
  } catch (error) {
    return {
      available: false,
      backend: "bubblewrap",
      executable,
      reason: error instanceof Error ? error.message : String(error),
      remediation: remediation(),
    };
  }
  return { available: true, backend: "bubblewrap", executable };
}

export function buildBubblewrapCommand(input: {
  executable: string;
  workspaceRoot: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}): string[] {
  const root = resolve(input.workspaceRoot);
  const cwd = resolve(input.cwd ?? root);
  if (!isAtOrWithin(root, cwd)) {
    throw new BoundaryPathError(cwd, root);
  }
  const args = [
    input.executable,
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup",
    "--unshare-net",
    "--clearenv",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--dir", "/home",
    "--dir", "/home/impulse",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind-try", "/bin", "/bin",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/etc/ssl", "/etc/ssl",
    "--bind", root, root,
    "--ro-bind-try", join(root, ".git"), join(root, ".git"),
    "--setenv", "HOME", "/home/impulse",
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
    "--setenv", "IMPULSE_EXECUTION_BOUNDARY", "isolated-preview",
  ];
  for (const [key, value] of Object.entries(input.env ?? {})) {
    args.push("--setenv", key, value);
  }
  args.push("--chdir", cwd, "--", ...input.command);
  return args;
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

async function fencedPath(root: string, input: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const target = resolve(root, input);
  if (!isAtOrWithin(canonicalRoot, target)) throw new BoundaryPathError(target, canonicalRoot);
  const existing = await nearestExistingPath(target);
  const canonicalExisting = await realpath(existing);
  if (!isAtOrWithin(canonicalRoot, canonicalExisting)) {
    throw new BoundaryPathError(target, canonicalRoot);
  }
  return target;
}

function isProtectedWorkspaceMetadata(root: string, target: string): boolean {
  const first = relative(root, target).split(sep)[0];
  return first === ".git" || first === ".impulse";
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

export async function createIsolatedPreviewBoundary(input: {
  workspaceRoot: string;
  capability?: BoundaryCapability;
  spawn?: BoundarySpawn;
}): Promise<ExecutionBoundary> {
  const root = await realpath(input.workspaceRoot);
  const capability = input.capability ?? await probeBubblewrap();
  if (!capability.available || !capability.executable) {
    throw new BoundaryUnavailableError(
      capability.reason ?? "An enforceable isolated-preview boundary is unavailable.",
      capability
    );
  }
  const spawn = input.spawn ?? defaultSpawn;
  const owned = new Set<BoundaryOwnedProcess>();
  const starting = new Set<Promise<void>>();
  let closed = false;
  let cleanupFlight: Promise<BoundaryCleanupResult> | undefined;

  return {
    descriptor: {
      kind: "isolated-preview",
      label: "PREVIEW",
      workspaceRoot: root,
      backend: "bubblewrap",
      network: "off",
    },
    async resolvePath(path, _operation) {
      const target = await fencedPath(root, path);
      if (isProtectedWorkspaceMetadata(root, target)) {
        throw new BoundaryPathError(target, root);
      }
      return target;
    },
    async run(command, options = {}) {
      if (command.length === 0) throw new Error("Preview command cannot be empty.");
      if (closed) throw new Error("Preview execution boundary is closed.");
      let releaseStart!: () => void;
      const start = new Promise<void>((resolveStart) => { releaseStart = resolveStart; });
      starting.add(start);
      let process: BoundaryOwnedProcess;
      try {
        const cwd = await fencedPath(root, options.cwd ?? root);
        const argv = buildBubblewrapCommand({
          executable: capability.executable!,
          workspaceRoot: root,
          command,
          cwd,
          ...(options.env ? { env: options.env } : {}),
        });
        process = spawn(argv, { cwd, ...(options.env ? { env: options.env } : {}) });
      owned.add(process);
      } finally {
        releaseStart();
        starting.delete(start);
      }
      try {
        const stdout = process!.stdout ? new Response(process!.stdout).text() : Promise.resolve("");
        const stderr = process!.stderr ? new Response(process!.stderr).text() : Promise.resolve("");
        const [exitCode, out, err] = await Promise.all([process!.exited, stdout, stderr]);
        return { exitCode, stdout: out, stderr: err };
      } finally {
        owned.delete(process!);
      }
    },
    cleanup() {
      if (cleanupFlight) return cleanupFlight;
      closed = true;
      cleanupFlight = (async () => {
        await Promise.all([...starting]);
        const processes = [...owned];
        const failures: string[] = [];
        await Promise.all(processes.map(async (process) => {
          try {
            await process.kill();
            await process.exited;
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
          }
        }));
        if (owned.size > 0 || failures.length > 0) {
          return {
            ok: false,
            stopped: processes.length - owned.size,
            reason: failures.join("; ") || `${owned.size} preview process(es) did not exit.`,
          };
        }
        return { ok: true, stopped: processes.length };
      })();
      return cleanupFlight;
    },
  };
}
