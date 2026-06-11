/**
 * Filesystem watcher that monitors .git/HEAD for branch changes from any source
 * (Impulse-internal commands or external terminal operations).
 *
 * Publishes branch.changed on the event bus when the branch changes, so the
 * ContextBar can invalidate its cache and re-read the current branch.
 *
 * Works alongside command-driven detection (branch-detect.ts) — both converge
 * on the same branch.changed event for the ContextBar to consume.
 */

import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "fs";
import { dirname, join, resolve } from "path";
import { Bus } from "../bus/index.js";
import { BranchEvents } from "../bus/events.js";

interface GitPaths {
  /** The working directory containing the repo (repo root, not .git dir) */
  repoDir: string;
  /** The .git directory (or the resolved gitdir for worktrees) */
  gitDir: string;
  /** Path to the HEAD file inside gitDir */
  headPath: string;
}

/**
 * Walk up from cwd to find .git.
 * Handles:
 * - Regular repos (.git is a directory)
 * - Worktrees (.git is a file containing "gitdir: /path/to/actual/.git")
 */
function findGitPaths(cwd: string): GitPaths | null {
  let dir = cwd;
  while (true) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const stat = statSync(gitPath);
        if (stat.isFile()) {
          // Worktree: .git is a file pointing to the real git dir
          const content = readFileSync(gitPath, "utf8").trim();
          if (content.startsWith("gitdir: ")) {
            const realGitDir = resolve(dir, content.slice(8).trim());
            const headPath = join(realGitDir, "HEAD");
            if (!existsSync(headPath)) return null;
            return { repoDir: dir, gitDir: realGitDir, headPath };
          }
        } else if (stat.isDirectory()) {
          const headPath = join(gitPath, "HEAD");
          if (!existsSync(headPath)) return null;
          return { repoDir: dir, gitDir: gitPath, headPath };
        }
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read .git/HEAD and extract the branch name.
 *
 * Returns:
 * - "main" for "ref: refs/heads/main"
 * - null for detached HEAD (raw SHA)
 * - null on error / unreadable
 */
function readHeadBranch(headPath: string): string | null {
  try {
    const content = readFileSync(headPath, "utf8").trim();
    if (content.startsWith("ref: refs/heads/")) {
      return content.slice(16);
    }
    // Detached HEAD (raw SHA) — return null (ContextBar shows nothing for this)
    return null;
  } catch {
    return null;
  }
}

const WATCH_DEBOUNCE_MS = 500;

/**
 * Watches the git HEAD file's parent directory for changes, debounces, and
 * publishes branch.changed when the branch differs from the cached value.
 *
 * Lifetime: created and started in ImpulseRenderer.start(), disposed in
 * gracefulExit(). One instance per Impulse session.
 */
export class GitBranchWatcher {
  private gitPaths: GitPaths | null;
  private cachedBranch: string | null | undefined = undefined;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(cwd: string) {
    this.gitPaths = findGitPaths(cwd);
  }

  /** Start watching the git HEAD directory. No-op if not in a git repo. */
  start(): void {
    if (this.disposed || !this.gitPaths) return;

    // Read initial branch so we don't fire on the first HEAD event
    this.cachedBranch = readHeadBranch(this.gitPaths.headPath);

    const headDir = dirname(this.gitPaths.headPath);

    try {
      this.watcher = watch(headDir, { persistent: true, recursive: false }, (_eventType, filename) => {
        // On Linux, filename is often null for directory watches even when HEAD changes.
        if (filename != null && filename !== "HEAD") return;
        this.scheduleRefresh();
      });
      this.watcher.on("error", () => {
        // fs.watch errors are non-fatal — silently stop watching.
        // Command-driven detection still works as fallback.
        this.closeWatcher();
      });
    } catch {
      // fs.watch may throw if the directory is inaccessible.
      // Silently no-op; command-driven detection still works.
    }
  }

  /** Stop watching and clean up. Safe to call multiple times. */
  dispose(): void {
    this.disposed = true;
    this.closeWatcher();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private closeWatcher(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* ignore */
      }
      this.watcher = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.disposed) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, WATCH_DEBOUNCE_MS);
  }

  private refresh(): void {
    if (this.disposed || !this.gitPaths) return;

    const branch = readHeadBranch(this.gitPaths.headPath);
    if (branch !== this.cachedBranch) {
      this.cachedBranch = branch;
      Bus.publish(BranchEvents.Changed, {});
    }
  }
}
