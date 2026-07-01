/**
 * Goal artifact storage — persists GoalState to .impulse/goals/<sessionId>/
 * mirroring the plan revision pattern in src/plan/revisions.ts.
 *
 * Files written per goal session:
 *   state.json  — full GoalState (mode 0o600)
 *   goal.md     — goal text (human-readable)
 *   progress.md — append-only judge/turn log
 */

import fs from "fs";
import { getGoalDir } from "./paths.js";
import type { GoalState } from "../session/goal-state.js";
import { writeJsonAtomic } from "../util/atomic-write.js";
import { getRevisionDir, toRelativePlanPath } from "../plan/paths.js";

function renderGoalMarkdown(state: GoalState, sessionId: string, cwd: string): string {
  const lines = ["# Goal", "", state.text, ""];

  if (state.planRevisionId) {
    const revisionDir = getRevisionDir(sessionId, state.planRevisionId, cwd);
    const tasksPathRel = toRelativePlanPath(`${revisionDir}/tasks.md`, cwd);
    lines.push(
      "## Plan reference",
      "",
      `- Revision: ${state.planRevisionId}`,
      `- Tasks: ${tasksPathRel}`,
      "",
      "## Acceptance criteria",
      "",
      "Complete when every task in the referenced tasks.md is checked off (judged each turn).",
      ""
    );
  }

  return lines.join("\n");
}

function statePath(goalDir: string): string {
  return `${goalDir}/state.json`;
}

function goalMdPath(goalDir: string): string {
  return `${goalDir}/goal.md`;
}

function progressMdPath(goalDir: string): string {
  return `${goalDir}/progress.md`;
}

/**
 * Persist a GoalState to the artifact directory for the given session.
 * Creates the directory if it does not exist.
 */
export async function writeGoalArtifact(
  sessionId: string,
  state: GoalState,
  cwd = process.cwd()
): Promise<void> {
  const dir = getGoalDir(sessionId, cwd);
  fs.mkdirSync(dir, { recursive: true });

  await writeJsonAtomic(statePath(dir), state);

  // goal.md — overwrite each time (tracks current goal text + plan reference)
  fs.writeFileSync(goalMdPath(dir), renderGoalMarkdown(state, sessionId, cwd), { mode: 0o600 });
}

/**
 * Append a judge verdict line to the session's progress log.
 */
export function appendGoalProgress(
  sessionId: string,
  entry: { turn: number; verdict: string; reason: string; timestamp: string },
  cwd = process.cwd()
): void {
  const dir = getGoalDir(sessionId, cwd);
  fs.mkdirSync(dir, { recursive: true });
  const line = `| ${entry.timestamp} | turn ${entry.turn} | ${entry.verdict} | ${entry.reason} |\n`;
  fs.appendFileSync(progressMdPath(dir), line, { encoding: "utf-8" });
}

/**
 * Load GoalState from the artifact directory.
 * Returns null if no artifact exists (fresh session or legacy session).
 */
export function readGoalArtifact(
  sessionId: string,
  cwd = process.cwd()
): GoalState | null {
  const dir = getGoalDir(sessionId, cwd);
  const file = statePath(dir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as GoalState;
  } catch {
    return null;
  }
}

/**
 * Remove the artifact directory for a session (used by /goal clear).
 */
export function deleteGoalArtifact(
  sessionId: string,
  cwd = process.cwd()
): void {
  const dir = getGoalDir(sessionId, cwd);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
