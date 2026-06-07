/**
 * @ path autocomplete for the main prompt (files + directories).
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import type { Editor } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const MAX_ENTRIES = 5000;
const INDEX_TTL_MS = 30_000;

export type AtPathEntry = {
  relativePath: string;
  isDir: boolean;
  label: string;
  value: string;
};

export function extractAtQuery(
  line: string,
  cursorCol: number
): { query: string; atIndex: number } | null {
  const before = line.slice(0, cursorCol);
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  if (line.trimStart().startsWith("!")) return null;
  const afterAt = before.slice(atIndex + 1);
  if (/\s/.test(afterAt)) return null;
  return { query: afterAt, atIndex };
}

export function formatAtLabel(relativePath: string, isDir: boolean): string {
  const prefix = isDir ? "dir/ " : "file ";
  return `${prefix}${relativePath}`;
}

export function expandAtTilde(query: string, cwd: string): string {
  if (!query.startsWith("~/")) return path.resolve(cwd, query);
  return path.join(os.homedir(), query.slice(2));
}

export function completionInsertValue(
  relativePath: string,
  query: string,
  cwd: string
): string {
  if (query.startsWith("~/")) {
    const abs = path.resolve(cwd, relativePath);
    const fromHome = path.relative(os.homedir(), abs);
    return fromHome && !fromHome.startsWith("..") ? `~/${fromHome}` : relativePath;
  }
  return relativePath;
}

async function walkDir(
  dir: string,
  cwd: string,
  entries: AtPathEntry[],
  depth = 0
): Promise<void> {
  if (entries.length >= MAX_ENTRIES || depth > 14) return;

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const name of names.sort()) {
    if (entries.length >= MAX_ENTRIES) break;
    if (name === "." || name === "..") continue;

    const full = path.join(dir, name);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }

    const isDir = st.isDirectory();
    const rel = path.relative(cwd, full);
    const displayRel = isDir ? `${rel}${path.sep}` : rel;

    entries.push({
      relativePath: displayRel,
      isDir,
      label: formatAtLabel(displayRel, isDir),
      value: displayRel,
    });

    if (isDir) {
      if (SKIP_DIRS.has(name)) continue;
      await walkDir(full, cwd, entries, depth + 1);
    }
  }
}

let indexCache: { cwd: string; builtAt: number; entries: AtPathEntry[] } | null = null;

export async function buildWorkspaceIndex(cwd: string): Promise<AtPathEntry[]> {
  const entries: AtPathEntry[] = [];
  await walkDir(cwd, cwd, entries);
  indexCache = { cwd, builtAt: Date.now(), entries };
  return entries;
}

async function getWorkspaceIndex(cwd: string): Promise<AtPathEntry[]> {
  if (
    indexCache &&
    indexCache.cwd === cwd &&
    Date.now() - indexCache.builtAt < INDEX_TTL_MS
  ) {
    return indexCache.entries;
  }
  return buildWorkspaceIndex(cwd);
}

export function invalidateWorkspaceIndex(): void {
  indexCache = null;
}

export function setAtAutocomplete(editor: Editor, getCwd: () => string): void {
  editor.setAutocompleteProvider({
    async getSuggestions(lines, cursorLine, cursorCol) {
      const line = lines[cursorLine] ?? "";
      const parsed = extractAtQuery(line, cursorCol);
      if (!parsed) return null;

      const cwd = getCwd();
      const index = await getWorkspaceIndex(cwd);
      const byPath = new Map(index.map((e) => [e.relativePath, e]));

      const query = parsed.query;
      const paths = index.map((e) => e.relativePath);
      const matched =
        query.length === 0
          ? paths.slice(0, 30)
          : fuzzyFilter(paths, query, (p) => p).slice(0, 30);

      if (matched.length === 0) return null;

      return {
        items: matched.map((p) => {
          const entry = byPath.get(p)!;
          return { value: entry.value, label: entry.label };
        }),
        prefix: query,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const line = lines[cursorLine] ?? "";
      const atCol = cursorCol - prefix.length - 1;
      const beforeAt = line.slice(0, atCol);
      const after = line.slice(cursorCol);
      const insert = completionInsertValue(String(item.value), prefix, getCwd());
      const newLine = `${beforeAt}@${insert}${after}`;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforeAt.length + 1 + insert.length,
      };
    },
  });
}
