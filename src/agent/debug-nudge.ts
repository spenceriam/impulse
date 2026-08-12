import fs from "fs";
import path from "path";

const DEBUG_MARKER = "[IMPULSE_DEBUG]";

/**
 * Nudge if edited files still contain temporary debug instrumentation.
 */
export function buildDebugInstrumentationNudge(
  editedFilePaths: string[],
  cwd = process.cwd()
): string | undefined {
  const hits: string[] = [];
  for (const rel of editedFilePaths) {
    const full = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    try {
      const content = fs.readFileSync(full, "utf-8");
      if (content.includes(DEBUG_MARKER)) {
        hits.push(rel);
      }
    } catch {
      // ignore missing/unreadable paths
    }
  }
  if (hits.length === 0) return undefined;
  const list = hits.slice(0, 8).join(", ");
  const more = hits.length > 8 ? ` (+${hits.length - 8} more)` : "";
  return `Remove ${DEBUG_MARKER} instrumentation before closing this debug pass: ${list}${more}`;
}
