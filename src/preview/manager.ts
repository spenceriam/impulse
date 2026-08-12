import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
} from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { randomUUID } from "crypto";
import {
  createIsolatedPreviewBoundary,
  probeBubblewrap,
  type BoundaryCapability,
  type ExecutionBoundary,
} from "../execution/boundary.js";
import { runWithExecutionContext } from "../execution/context.js";
import { executeSubagent, type SubagentRunResult } from "../agent/task-runner.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { sanitizePath } from "../util/path.js";

export type PreviewBoundaryFactory = (
  workspaceRoot: string,
  capability: BoundaryCapability
) => Promise<ExecutionBoundary>;

export interface PreviewRunnerContext {
  workspacePath: string;
  boundary: ExecutionBoundary;
  signal: AbortSignal;
}

export type PreviewRunner = (context: PreviewRunnerContext) => Promise<SubagentRunResult>;

export interface PreviewRequest {
  prompt: string;
  description: string;
  runner?: PreviewRunner;
}

export interface PreviewReview {
  status: "ready";
  id: string;
  rootPath: string;
  workspacePath: string;
  patch: string;
  changedFiles: string[];
  diffStat: string;
  agentSummary: string[];
  agentOutput: string;
  boundary: { backend: "bubblewrap"; network: "off" };
  cleanup: { processes: "confirmed"; workspace: "kept-for-review" };
}

export interface PreviewUnavailable {
  status: "unavailable";
  notice: string;
  remediation?: string;
}

export interface PreviewFailed {
  status: "failed";
  notice: string;
  rootPath?: string;
  workspacePath?: string;
}

export type PreviewResult = PreviewReview | PreviewUnavailable | PreviewFailed;

type Snapshot =
  | { kind: "file"; bytes: Buffer; mode: number }
  | { kind: "symlink"; target: string }
  | { kind: "missing" };

interface PreviewRecord extends PreviewReview {
  baseline: Map<string, Snapshot>;
}

interface PreviewManagerOptions {
  activeWorkspace: string;
  tempParent?: string;
  probe?: () => Promise<BoundaryCapability>;
  boundaryFactory?: PreviewBoundaryFactory;
  beforeApplyWrite?: (path: string, index: number) => Promise<void>;
  removePreviewRoot?: (path: string) => Promise<void>;
}

function isProtectedPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  return normalized === ".git" || normalized.startsWith(".git/") ||
    normalized === ".impulse" || normalized.startsWith(".impulse/");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function run(
  command: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`${command[0]} exited ${code}: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

async function snapshot(path: string): Promise<Snapshot> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return { kind: "symlink", target: await readlink(path) };
    if (!info.isFile()) throw new Error(`Preview supports files and symlinks only: ${path}`);
    return { kind: "file", bytes: await readFile(path), mode: info.mode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "missing" || b.kind === "missing") return true;
  if (a.kind === "symlink" && b.kind === "symlink") return a.target === b.target;
  if (a.kind === "file" && b.kind === "file") {
    return a.mode === b.mode && Buffer.from(a.bytes).equals(Buffer.from(b.bytes));
  }
  return false;
}

async function copySnapshot(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { force: true, recursive: info.isDirectory() });
  if (info.isSymbolicLink()) {
    await symlink(await readlink(source), destination);
    return;
  }
  if (!info.isFile()) throw new Error(`Unsupported workspace entry: ${source}`);
  await copyFile(source, destination);
  await chmod(destination, info.mode);
}

function splitNull(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function parseNameStatus(output: string): string[] {
  const fields = splitNull(output);
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index] ?? "";
    const path = fields[index + 1];
    if (!path) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const destination = fields[index + 2];
      if (destination) paths.push(destination);
      index += 1;
    } else {
      paths.push(path);
    }
  }
  return [...new Set(paths)].filter((path) => !isProtectedPath(path)).sort();
}

export class PreviewManager {
  private readonly activeWorkspace: string;
  private readonly tempParent: string;
  private readonly probe: () => Promise<BoundaryCapability>;
  private readonly boundaryFactory: PreviewBoundaryFactory;
  private readonly beforeApplyWrite: ((path: string, index: number) => Promise<void>) | undefined;
  private readonly removePreviewRoot: (path: string) => Promise<void>;
  private readonly previews = new Map<string, PreviewRecord>();

  constructor(options: PreviewManagerOptions) {
    this.activeWorkspace = resolve(options.activeWorkspace);
    this.tempParent = resolve(options.tempParent ?? tmpdir());
    this.probe = options.probe ?? probeBubblewrap;
    this.boundaryFactory = options.boundaryFactory ?? ((root, capability) =>
      createIsolatedPreviewBoundary({ workspaceRoot: root, capability }));
    this.beforeApplyWrite = options.beforeApplyWrite;
    this.removePreviewRoot = options.removePreviewRoot ?? ((path) => rm(path, { recursive: true, force: true }));
  }

  list(): PreviewReview[] {
    return [...this.previews.values()].map(({ baseline: _baseline, ...review }) => review);
  }

  get(id: string): PreviewReview | undefined {
    const record = this.previews.get(id);
    if (!record) return undefined;
    const { baseline: _baseline, ...review } = record;
    return review;
  }

  async preview(request: PreviewRequest): Promise<PreviewResult> {
    const capability = await this.probe();
    if (!capability.available) {
      return {
        status: "unavailable",
        notice: `Safe preview unavailable: ${capability.reason ?? "isolation could not be enforced"}`,
        ...(capability.remediation ? { remediation: capability.remediation } : {}),
      };
    }

    await mkdir(this.tempParent, { recursive: true });
    const rootPath = await mkdtemp(join(this.tempParent, "impulse-preview-"));
    const repositoryPath = join(rootPath, "repository");
    const workspacePath = join(rootPath, "worktree");
    const gitHome = join(rootPath, "home");
    const gitEnv = {
      HOME: gitHome,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    };
    const baseline = new Map<string, Snapshot>();
    let boundary: ExecutionBoundary | undefined;

    try {
      await mkdir(gitHome, { recursive: true });
      const head = (await run(["git", "rev-parse", "HEAD"], { cwd: this.activeWorkspace, env: gitEnv })).trim();
      const tracked = splitNull(await run(["git", "ls-files", "-z"], { cwd: this.activeWorkspace, env: gitEnv }));
      const untracked = splitNull(await run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        { cwd: this.activeWorkspace, env: gitEnv }
      ));
      const materialPaths = [...new Set([...tracked, ...untracked])]
        .filter((path) => !isProtectedPath(path))
        .sort();

      for (const file of materialPaths) {
        baseline.set(file, await snapshot(join(this.activeWorkspace, file)));
      }

      await run(["git", "clone", "--no-hardlinks", "--no-checkout", this.activeWorkspace, repositoryPath], {
        cwd: rootPath,
        env: gitEnv,
      });
      await run(["git", "checkout", "--detach", head], { cwd: repositoryPath, env: gitEnv });

      for (const file of materialPaths) {
        const source = join(this.activeWorkspace, file);
        const target = join(repositoryPath, file);
        const state = baseline.get(file)!;
        if (state.kind === "missing") {
          await rm(target, { force: true });
        } else {
          await copySnapshot(source, target);
        }
      }
      await rm(join(repositoryPath, ".impulse"), { recursive: true, force: true });
      await run(["git", "add", "-A"], { cwd: repositoryPath, env: gitEnv });
      await run([
        "git", "-c", "user.name=Impulse Preview", "-c", "user.email=preview@invalid",
        "commit", "--allow-empty", "-m", "Impulse preview baseline",
      ], { cwd: repositoryPath, env: gitEnv });
      const baselineCommit = (await run(["git", "rev-parse", "HEAD"], { cwd: repositoryPath, env: gitEnv })).trim();
      await run(["git", "worktree", "add", "--detach", workspacePath, baselineCommit], {
        cwd: repositoryPath,
        env: gitEnv,
      });

      boundary = await this.boundaryFactory(workspacePath, capability);
      const id = randomUUID();
      const controller = new AbortController();
      const runner = request.runner ?? ((context: PreviewRunnerContext) =>
        executeSubagent("general", request.prompt, request.description, undefined, {
          parentToolCallId: `preview:${id}`,
          signal: context.signal,
        }));
      const agent = await runWithExecutionContext(
        { cwd: workspacePath, boundary },
        () => runner({ workspacePath, boundary: boundary!, signal: controller.signal })
      );
      const cleanup = await boundary.cleanup();
      if (!cleanup.ok) {
        return {
          status: "failed",
          notice: `Preview execution did not stop cleanly: ${cleanup.reason ?? "unknown cleanup failure"}`,
          rootPath,
          workspacePath,
        };
      }

      // Indexing happens only in the disposable preview repository and makes
      // newly-created files part of the review delta without touching host Git metadata.
      await run(["git", "add", "-A"], { cwd: workspacePath, env: gitEnv });
      const patch = await run(["git", "diff", "--binary", baselineCommit, "--"], {
        cwd: workspacePath,
        env: gitEnv,
      });
      const changedFiles = parseNameStatus(await run(
        ["git", "diff", "--name-status", "-z", "--no-renames", baselineCommit, "--"],
        { cwd: workspacePath, env: gitEnv }
      ));
      const diffStat = (await run(["git", "diff", "--stat", baselineCommit, "--"], {
        cwd: workspacePath,
        env: gitEnv,
      })).trim();
      const review: PreviewRecord = {
        status: "ready",
        id,
        rootPath,
        workspacePath,
        patch,
        changedFiles,
        diffStat,
        agentSummary: agent.summary,
        agentOutput: agent.output,
        boundary: { backend: "bubblewrap", network: "off" },
        cleanup: { processes: "confirmed", workspace: "kept-for-review" },
        baseline,
      };
      this.previews.set(id, review);
      return review;
    } catch (error) {
      if (boundary) {
        const cleanup = await boundary.cleanup();
        if (!cleanup.ok) {
          return {
            status: "failed",
            notice: `${error instanceof Error ? error.message : String(error)}; cleanup failed: ${cleanup.reason}`,
            rootPath,
            workspacePath,
          };
        }
      }
      await rm(rootPath, { recursive: true, force: true });
      return { status: "failed", notice: error instanceof Error ? error.message : String(error) };
    }
  }

  async apply(id: string): Promise<
    | { ok: true; status: "applied"; changedFiles: string[] }
    | { ok: false; status: "missing" | "conflict" | "rollback" | "cleanup"; notice: string; safeToReturnToAsk: boolean }
  > {
    const preview = this.previews.get(id);
    if (!preview) return { ok: false, status: "missing", notice: "Preview not found.", safeToReturnToAsk: true };

    const preflight = await this.checkApply(id);
    if (!preflight.ok) return preflight;

    const backups = new Map<string, Snapshot>();
    try {
      // Recheck immediately before the first mutation to close the review/apply race.
      const finalCheck = await this.checkApply(id);
      if (!finalCheck.ok) return finalCheck;

      for (const file of preview.changedFiles) {
        if (isProtectedPath(file)) throw new Error(`Protected preview path: ${file}`);
        const target = sanitizePath(file, { baseDir: this.activeWorkspace });
        backups.set(file, await snapshot(target));
      }

      let index = 0;
      for (const file of preview.changedFiles) {
        const target = sanitizePath(file, { baseDir: this.activeWorkspace });
        const source = join(preview.workspacePath, file);
        await this.beforeApplyWrite?.(file, index++);
        const sourceState = await snapshot(source);
        if (sourceState.kind === "missing") {
          await rm(target, { force: true });
        } else if (sourceState.kind === "symlink") {
          throw new Error(`Applying symlink changes is not supported: ${file}`);
        } else {
          await mkdir(dirname(target), { recursive: true });
          await writeFileAtomic(target, sourceState.bytes, { mode: sourceState.mode });
        }
      }
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const [file, backup] of backups) {
        const target = sanitizePath(file, { baseDir: this.activeWorkspace });
        try {
          if (backup.kind === "missing") {
            await rm(target, { force: true });
          } else if (backup.kind === "symlink") {
            await rm(target, { force: true });
            await mkdir(dirname(target), { recursive: true });
            await symlink(backup.target, target);
          } else {
            await mkdir(dirname(target), { recursive: true });
            await writeFileAtomic(target, backup.bytes, { mode: backup.mode });
          }
        } catch (rollbackError) {
          rollbackFailures.push(`${file}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }
      return {
        ok: false,
        status: "rollback",
        safeToReturnToAsk: rollbackFailures.length === 0,
        notice: rollbackFailures.length > 0
          ? `Apply failed; rollback incomplete (${rollbackFailures.join("; ")}). Preview kept at ${preview.rootPath}.`
          : `Apply failed and was rolled back: ${error instanceof Error ? error.message : String(error)}. Preview kept for review.`,
      };
    }

    const discarded = await this.discard(id);
    if (!discarded.ok) {
      return {
        ok: false,
        status: "cleanup",
        notice: `Reviewed delta was applied, but ${discarded.notice} AGENT remains active.`,
        safeToReturnToAsk: false,
      };
    }
    return { ok: true, status: "applied", changedFiles: preview.changedFiles };
  }

  async checkApply(id: string): Promise<
    | { ok: true; changedFiles: string[] }
    | { ok: false; status: "missing" | "conflict"; notice: string; safeToReturnToAsk: true }
  > {
    const preview = this.previews.get(id);
    if (!preview) {
      return { ok: false, status: "missing", notice: "Preview not found.", safeToReturnToAsk: true };
    }
    for (const file of preview.changedFiles) {
      const expected = preview.baseline.get(file) ?? { kind: "missing" as const };
      const current = await snapshot(join(this.activeWorkspace, file));
      if (!snapshotsEqual(expected, current)) {
        return {
          ok: false,
          status: "conflict",
          notice: `Active workspace changed since preview: ${file}. Preview kept for review.`,
          safeToReturnToAsk: true,
        };
      }
    }
    return { ok: true, changedFiles: preview.changedFiles };
  }

  async discard(id: string): Promise<{ ok: boolean; notice: string }> {
    const preview = this.previews.get(id);
    if (!preview) return { ok: false, notice: "Preview not found." };
    try {
      await this.removePreviewRoot(preview.rootPath);
      this.previews.delete(id);
      return { ok: true, notice: "Preview discarded and cleaned." };
    } catch (error) {
      return {
        ok: false,
        notice: `Preview cleanup failed; kept at ${preview.rootPath}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  keep(id: string): { path: string; cleanupCommand: string } {
    const preview = this.previews.get(id);
    if (!preview) throw new Error("Preview not found.");
    return {
      path: preview.workspacePath,
      cleanupCommand: `rm -rf -- ${shellQuote(preview.rootPath)}`,
    };
  }

  async discardAll(): Promise<void> {
    for (const id of [...this.previews.keys()]) await this.discard(id);
  }
}
