/**
 * Detect git branch switches from shell commands and publish branch.changed events.
 *
 * Called from both the bash tool and user-shell (!command) paths so the
 * ContextBar can invalidate its branch cache after a checkout/switch/rename.
 */

import { execSync } from "child_process";
import { Bus } from "../bus/index.js";
import { BranchEvents } from "../bus/events.js";

/**
 * Regex patterns for git commands that switch, create, or rename the current branch.
 *
 * We intentionally exclude file/path checkouts (git checkout ., git checkout -- <path>)
 * because those do not change the branch.
 */
const BRANCH_SWITCH_PATTERNS: RegExp[] = [
  // git checkout <branch> (not files: no ".", "--", or explicit path after "checkout")
  /\bgit\s+checkout\s+(?!\.)(?!--\s)(?!.*\s+--\s)(.+)/,
  // git switch <branch> (creates or switches)
  /\bgit\s+switch\s+/,
  // git branch -m/-M (rename — may rename the current branch)
  /\bgit\s+branch\s+-[mM]\s+/,
];

/**
 * Check if a command looks like a branch-switching git operation.
 */
function isBranchSwitchCommand(command: string): boolean {
  const trimmed = command.trim();
  for (const pattern of BRANCH_SWITCH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * After a git command completes, check if it was a branch switch and publish a
 * branch.changed event so the ContextBar can refresh.
 *
 * Call this from both the bash tool and user-shell paths.
 */
export function detectAndPublishBranchChange(command: string, cwd: string): void {
  if (!isBranchSwitchCommand(command)) {
    return;
  }

  // Verify we're in a git repo and can resolve the branch.
  // If this fails (no git repo, detached HEAD, error), we skip — no harm done.
  try {
    execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
  } catch {
    return;
  }

  Bus.publish(BranchEvents.Changed, {});
}
