import fs from "fs";
import path from "path";
import {
  allowedPlanFilenames,
  getRevisionDir,
  getRevisionsRoot,
  toRelativePlanPath,
  type PlanningStyle,
} from "./paths.js";

export type { PlanningStyle } from "./paths.js";

export interface PlanRevisionMeta {
  revisionId: string;
  revises: string;
  createdAt: string;
  active: boolean;
  planningStyle: PlanningStyle;
}

export interface PlanRevision {
  meta: PlanRevisionMeta;
  dir: string;
  files: Record<string, string>;
}

export function formatRevisionId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 23);
}

function metaPath(revisionDir: string): string {
  return path.join(revisionDir, "meta.json");
}

function readMeta(revisionDir: string): PlanRevisionMeta | null {
  const file = metaPath(revisionDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as PlanRevisionMeta;
  } catch {
    return null;
  }
}

function writeMeta(revisionDir: string, meta: PlanRevisionMeta): void {
  fs.writeFileSync(metaPath(revisionDir), JSON.stringify(meta, null, 2), { mode: 0o600 });
}

function buildFilePaths(revisionDir: string, style: PlanningStyle): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of allowedPlanFilenames(style)) {
    files[name] = path.join(revisionDir, name);
  }
  return files;
}

export function listRevisionIds(sessionId: string, cwd = process.cwd()): string[] {
  const root = getRevisionsRoot(sessionId, cwd);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function deactivateAllRevisions(sessionId: string, cwd: string): void {
  for (const id of listRevisionIds(sessionId, cwd)) {
    const dir = getRevisionDir(sessionId, id, cwd);
    const meta = readMeta(dir);
    if (meta?.active) {
      writeMeta(dir, { ...meta, active: false });
    }
  }
}

/**
 * Create a new plan revision and mark it active (latest wins).
 */
export function createPlanRevision(
  sessionId: string,
  options?: { revises?: string; planningStyle?: PlanningStyle; revisionId?: string },
  cwd = process.cwd()
): PlanRevision {
  const revisionsRoot = getRevisionsRoot(sessionId, cwd);
  fs.mkdirSync(revisionsRoot, { recursive: true });

  const priorActive = getActivePlanRevision(sessionId, cwd);
  const revises =
    options?.revises ??
    (priorActive ? priorActive.meta.revisionId : "initial");
  const planningStyle = options?.planningStyle ?? priorActive?.meta.planningStyle ?? "spec";
  const revisionId =
    options?.revisionId ??
    (revises === "initial" && !priorActive ? "initial" : formatRevisionId());

  deactivateAllRevisions(sessionId, cwd);

  const dir = getRevisionDir(sessionId, revisionId, cwd);
  fs.mkdirSync(dir, { recursive: true });

  const meta: PlanRevisionMeta = {
    revisionId,
    revises,
    createdAt: new Date().toISOString(),
    active: true,
    planningStyle,
  };
  writeMeta(dir, meta);

  return { meta, dir, files: buildFilePaths(dir, planningStyle) };
}

/**
 * Latest revision by createdAt; falls back to revisionId sort if needed.
 */
export function getActivePlanRevision(sessionId: string, cwd = process.cwd()): PlanRevision | null {
  const root = getRevisionsRoot(sessionId, cwd);
  if (!fs.existsSync(root)) return null;

  let best: PlanRevision | null = null;
  let bestTime = "";

  for (const id of listRevisionIds(sessionId, cwd)) {
    const dir = getRevisionDir(sessionId, id, cwd);
    const meta = readMeta(dir);
    if (!meta?.active) continue;
    if (!best || meta.createdAt >= bestTime) {
      bestTime = meta.createdAt;
      best = {
        meta,
        dir,
        files: buildFilePaths(dir, meta.planningStyle),
      };
    }
  }

  if (best) return best;

  // Fallback: newest revision by createdAt even if active flag missing
  for (const id of listRevisionIds(sessionId, cwd)) {
    const dir = getRevisionDir(sessionId, id, cwd);
    const meta = readMeta(dir);
    if (!meta) continue;
    if (!best || meta.createdAt >= bestTime) {
      bestTime = meta.createdAt;
      best = { meta, dir, files: buildFilePaths(dir, meta.planningStyle) };
    }
  }

  return best;
}

export function ensureActivePlanRevision(sessionId: string, cwd = process.cwd()): PlanRevision {
  return getActivePlanRevision(sessionId, cwd) ?? createPlanRevision(sessionId, undefined, cwd);
}

/** Read a specific revision's tasks.md, or null if the revision or file is missing. */
export function readPlanTasksMarkdown(
  sessionId: string,
  revisionId: string,
  cwd = process.cwd()
): string | null {
  const dir = getRevisionDir(sessionId, revisionId, cwd);
  const tasksPath = path.join(dir, "tasks.md");
  if (!fs.existsSync(tasksPath)) return null;
  try {
    return fs.readFileSync(tasksPath, "utf-8");
  } catch {
    return null;
  }
}

export function setPlanningStyleForActiveRevision(
  sessionId: string,
  style: PlanningStyle,
  cwd = process.cwd()
): PlanRevision | null {
  const active = getActivePlanRevision(sessionId, cwd);
  if (!active) return null;
  const meta = { ...active.meta, planningStyle: style };
  writeMeta(active.dir, meta);
  return { meta, dir: active.dir, files: buildFilePaths(active.dir, style) };
}

/** Stored-plan write path check: active revision directory and allowed filenames only. */
export function validatePlanWritePath(
  filePath: string,
  sessionId: string,
  cwd = process.cwd()
): string | null {
  const active = getActivePlanRevision(sessionId, cwd);
  const revisionDir = active?.dir ?? getRevisionDir(sessionId, "initial", cwd);
  const planningStyle = active?.meta.planningStyle ?? "spec";
  const resolved = path.resolve(cwd, filePath);
  const activeDir = path.resolve(revisionDir);

  const rel = path.relative(activeDir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return (
      `Stored plan files must stay under the active revision: ${toRelativePlanPath(activeDir, cwd)}. ` +
      `Requested: ${filePath}. Use plan_revision to start a new revision before writing elsewhere.`
    );
  }

  const base = path.basename(resolved).toLowerCase();
  const allowed = allowedPlanFilenames(planningStyle).map((f) => f.toLowerCase());
  if (!allowed.includes(base)) {
    return (
      `Stored plan revisions allow only: ${allowed.join(", ")} in the active revision. ` +
      `For TDD artifacts (e.g. PRD.md), confirm TDD with the user via the question tool first.`
    );
  }

  if (!active) {
    createPlanRevision(sessionId, undefined, cwd);
  }

  return null;
}

export function buildStoredPlanContextBlock(sessionId: string, cwd = process.cwd()): string {
  const active = getActivePlanRevision(sessionId, cwd);
  if (!active) {
    return `
## Active stored plan

No plan revision yet. On first plan write, revision \`initial\` will be created under \`.impulse/plans/${sessionId}/revisions/\`.
Use \`plan_revision\` when the user asks to rework the plan (creates a new revision; latest revision is always current context).
`.trim();
  }

  const fileList = Object.entries(active.files)
    .map(([name, p]) => `- ${name}: ${toRelativePlanPath(p, cwd)}`)
    .join("\n");

  return `
## Active stored plan — latest revision only

Revision: \`${active.meta.revisionId}\` (revises: ${active.meta.revises})
Style: ${active.meta.planningStyle}
Directory: ${toRelativePlanPath(active.dir, cwd)}

Write or edit ONLY these files in the active revision:
${fileList}

Rules:
- Older revisions are historical; do not treat them as current unless the user asks to read them.
- To rework the plan, call \`plan_revision\` first, then write new files (do not overwrite superseded revisions).
- Default is spec-driven (design + spec + tasks). For TDD, confirm with the question tool before adding PRD.md.
`.trim();
}
