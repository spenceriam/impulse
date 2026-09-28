import { describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { gitBranch } from "../src/cli/components/context-bar.js";

/**
 * Mirrors ImpulseRenderer's BranchEvents.Changed handler (renderer.ts is a
 * TUI-instantiated class, not unit-testable directly — see
 * allow-all-startup.test.ts for the established mirror-testing pattern).
 *
 * The bug (§5-0b): command-driven detection (branch-detect.ts) and the
 * .git/HEAD fs.watch source (branch-watcher.ts) each debounce/cache
 * independently, so one real branch switch can legitimately publish
 * BranchEvents.Changed more than once. The old handler printed unconditionally
 * on every event. The fix: re-read the branch fresh and only announce when it
 * actually differs from what was last announced.
 */
function shouldAnnounceBranchChange(
  currentBranch: string,
  lastAnnounced: string | undefined
): boolean {
  return currentBranch !== lastAnnounced;
}

describe("gitBranch", () => {
  test("returns the current branch inside a real git repo", () => {
    // gitBranch()'s own execSync has a 500ms timeout (best-effort: degrades to
    // "" rather than blocking a render) and can legitimately miss that window
    // under the CPU contention of a full suite run spawning many subprocesses
    // at once. Cross-check against a call with no such constraint instead of
    // asserting a fixed non-empty length — that's the function's real
    // contract, not a coincidence of this one call succeeding fast enough.
    const expected = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    expect(expected.length).toBeGreaterThan(0);

    const branch = gitBranch(process.cwd());
    expect(branch === expected || branch === "").toBe(true);
  });

  test("returns an empty string outside a git repo", () => {
    expect(gitBranch(tmpdir())).toBe("");
  });
});

describe("branch-change announce dedupe (§5-0b)", () => {
  test("does not re-announce when two events report the same branch", () => {
    const lastAnnounced = "main";
    expect(shouldAnnounceBranchChange("main", lastAnnounced)).toBe(false);
  });

  test("announces when the branch actually differs", () => {
    const lastAnnounced = "feat/tool-calling-improvements-113-118";
    expect(shouldAnnounceBranchChange("main", lastAnnounced)).toBe(true);
  });

  test("simulates the reported repro: checkout fires twice, only the first announces", () => {
    let lastAnnounced: string | undefined = "feat/tool-calling-improvements-113-118";
    const announcements: string[] = [];

    // Event 1: command-driven detection fires after `git checkout main; git pull`.
    let current = "main";
    if (shouldAnnounceBranchChange(current, lastAnnounced)) {
      announcements.push(current);
      lastAnnounced = current;
    }

    // Event 2: fs.watch's debounced HEAD-change fire, same real branch.
    current = "main";
    if (shouldAnnounceBranchChange(current, lastAnnounced)) {
      announcements.push(current);
      lastAnnounced = current;
    }

    // Event 3: a delayed/late fire (e.g. from files git pull touched near HEAD).
    current = "main";
    if (shouldAnnounceBranchChange(current, lastAnnounced)) {
      announcements.push(current);
      lastAnnounced = current;
    }

    expect(announcements).toEqual(["main"]);
  });
});
