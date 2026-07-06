import path from "path";
import { readdir } from "fs/promises";

const PROBE_TIMEOUT_MS = 1500;
const MAX_RENDER_DEPTH = 3;
const MAX_BLOCK_LINES = 40;
const MAX_BLOCK_CHARS = 2000;
/** Beyond this many scanned files the block is skipped entirely (huge repos). */
const MAX_SCANNED_FILES = 20_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

interface DirNode {
  files: number;
  totalFiles: number;
  children: Map<string, DirNode>;
}

function newDirNode(): DirNode {
  return { files: 0, totalFiles: 0, children: new Map() };
}

/** Insert a repo-relative file path (posix or win32 separators) into the tree. */
function insertPath(root: DirNode, relPath: string): void {
  const segments = relPath.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return;
  segments.pop(); // drop the file name; only directory segments are tracked

  let node = root;
  root.totalFiles++;
  for (const segment of segments) {
    let child = node.children.get(segment);
    if (!child) {
      child = newDirNode();
      node.children.set(segment, child);
    }
    child.totalFiles++;
    node = child;
  }
  node.files++;
}

async function probeGitFiles(cwd: string): Promise<string[] | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = new Promise<"timeout">((resolve) =>
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        resolve("timeout");
      }, PROBE_TIMEOUT_MS)
    );
    const result = await Promise.race([new Response(proc.stdout).text(), timer]);
    if (result === "timeout") return null;
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return result.split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

async function walkFallback(dir: string, cwd: string, out: string[], depth = 0): Promise<void> {
  if (out.length >= MAX_SCANNED_FILES || depth > 8) return;

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= MAX_SCANNED_FILES) return;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkFallback(path.join(dir, entry.name), cwd, out, depth + 1);
    } else {
      out.push(path.relative(cwd, path.join(dir, entry.name)));
    }
  }
}

/** Render a directory's children, collapsing to a file-count summary past maxDepth or leaf dirs. */
function renderDir(node: DirNode, name: string, depth: number, maxDepth: number, indent: string): string[] {
  if (depth >= maxDepth || node.children.size === 0) {
    return [`${indent}${name}/ (${node.totalFiles} files)`];
  }
  const lines = [`${indent}${name}/`];
  const sortedChildren = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [childName, child] of sortedChildren) {
    lines.push(...renderDir(child, childName, depth + 1, maxDepth, `${indent}  `));
  }
  return lines;
}

function renderTree(root: DirNode, maxDepth: number): string[] {
  const lines: string[] = [];
  const sortedDirs = [...root.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, child] of sortedDirs) {
    lines.push(...renderDir(child, name, 1, maxDepth, ""));
  }
  return lines;
}

export interface ProjectStructureProbe {
  root: DirNode;
  rootLooseFiles: string[];
}

/** Build a probe tree from a flat list of repo-relative file paths (pure, for tests). */
export function buildProjectStructureProbe(files: string[]): ProjectStructureProbe | null {
  if (files.length === 0 || files.length > MAX_SCANNED_FILES) return null;

  const root = newDirNode();
  const rootLooseFiles: string[] = [];
  for (const rel of files) {
    const segments = rel.split(/[\\/]/).filter(Boolean);
    if (segments.length === 1) {
      rootLooseFiles.push(segments[0]!);
      root.files++;
      root.totalFiles++;
    } else {
      insertPath(root, rel);
    }
  }
  rootLooseFiles.sort((a, b) => a.localeCompare(b));

  return { root, rootLooseFiles };
}

async function probeProjectStructureUncached(cwd: string): Promise<ProjectStructureProbe | null> {
  const gitFiles = await probeGitFiles(cwd);
  const files = gitFiles ?? (await (async () => {
    const out: string[] = [];
    await walkFallback(cwd, cwd, out);
    return out;
  })());

  return buildProjectStructureProbe(files);
}

let cachedCwd: string | null = null;
let cachedProbe: Promise<ProjectStructureProbe | null> | undefined;

export function probeProjectStructure(cwd = process.cwd()): Promise<ProjectStructureProbe | null> {
  if (cachedCwd !== cwd) {
    cachedCwd = cwd;
    cachedProbe = undefined;
  }
  cachedProbe ??= probeProjectStructureUncached(cwd);
  return cachedProbe;
}

export function clearProjectStructureCache(): void {
  cachedCwd = null;
  cachedProbe = undefined;
}

export function formatProjectStructureBlock(probe: ProjectStructureProbe | null): string {
  if (!probe) return "";

  for (const maxDepth of [MAX_RENDER_DEPTH, 2, 1]) {
    const lines = renderTree(probe.root, maxDepth);
    if (probe.rootLooseFiles.length > 0) {
      lines.push(probe.rootLooseFiles.join("  "));
    }
    const body = lines.join("\n");
    if (lines.length <= MAX_BLOCK_LINES && body.length <= MAX_BLOCK_CHARS) {
      return `## Project structure (depth ${maxDepth}, gitignore-respecting)\n${body}`;
    }
  }
  return "";
}
