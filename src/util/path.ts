import path from "path";
import fs from "fs";

class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

function isWithinBase(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realpathOrResolved(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

/**
 * Resolve a path to its canonical form while tolerating missing leaf segments.
 * This resolves symlinks in existing ancestors so path checks cannot be bypassed
 * by a symlinked directory with a non-existent child.
 */
function resolveWithExistingAncestors(targetPath: string): string {
  const segments: string[] = [];
  let cursor = path.resolve(targetPath);

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    segments.unshift(path.basename(cursor));
    cursor = parent;
  }

  let resolved = realpathOrResolved(cursor);
  for (const segment of segments) {
    resolved = path.join(resolved, segment);
  }
  return resolved;
}

function sanitizePath(filePath: string, baseDir: string = process.cwd()): string {
  const resolved = path.resolve(baseDir, filePath);
  const normalizedBaseDir = path.resolve(baseDir);

  if (!isWithinBase(normalizedBaseDir, resolved)) {
    throw new SecurityError(`Path traversal detected: ${filePath}`);
  }

  const realBaseDir = realpathOrResolved(normalizedBaseDir);
  const realPath = resolveWithExistingAncestors(resolved);

  if (!isWithinBase(realBaseDir, realPath)) {
    throw new SecurityError(`Symlink bypass detected: ${filePath}`);
  }

  return realPath;
}

export { sanitizePath, SecurityError };
