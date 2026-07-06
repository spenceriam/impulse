import path from "path";

export const GOAL_ROOT_DIR = ".impulse/goals";

export function getGoalDir(sessionId: string, cwd = process.cwd()): string {
  return path.join(cwd, GOAL_ROOT_DIR, sessionId);
}

export function toRelativeGoalPath(absolutePath: string, cwd = process.cwd()): string {
  const normalized = absolutePath.replaceAll("\\", "/");
  const base = cwd.replaceAll("\\", "/");
  if (normalized.startsWith(base)) {
    return normalized.slice(base.length).replace(/^\//, "");
  }
  return normalized;
}
