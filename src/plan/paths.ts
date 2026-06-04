import path from "path";

export const PLAN_ROOT_DIR = ".impulse/plans";
export const REVISIONS_SUBDIR = "revisions";

export const SPEC_PLAN_FILES = ["design.md", "spec.md", "tasks.md"] as const;
export const TDD_PLAN_FILES = ["PRD.md"] as const;

export type PlanningStyle = "spec" | "tdd";

export function getPlanSessionRoot(sessionId: string, cwd = process.cwd()): string {
  return path.join(cwd, PLAN_ROOT_DIR, sessionId);
}

export function getRevisionsRoot(sessionId: string, cwd = process.cwd()): string {
  return path.join(getPlanSessionRoot(sessionId, cwd), REVISIONS_SUBDIR);
}

export function getRevisionDir(
  sessionId: string,
  revisionId: string,
  cwd = process.cwd()
): string {
  return path.join(getRevisionsRoot(sessionId, cwd), revisionId);
}

export function allowedPlanFilenames(style: PlanningStyle): readonly string[] {
  return style === "tdd"
    ? [...SPEC_PLAN_FILES, ...TDD_PLAN_FILES]
    : SPEC_PLAN_FILES;
}

export function toRelativePlanPath(absolutePath: string, cwd = process.cwd()): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const base = cwd.replace(/\\/g, "/");
  if (normalized.startsWith(base)) {
    return normalized.slice(base.length).replace(/^\//, "");
  }
  return normalized;
}