import path from "path";
import fs from "fs";
import os from "os";

class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

type PathModule = Pick<typeof path, "isAbsolute" | "relative" | "resolve" | "sep">;

function isParentRelativePath(relativePath: string, pathModule: PathModule = path): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${pathModule.sep}`);
}

function isWithinBase(baseDir: string, targetPath: string, pathModule: PathModule = path): boolean {
  const normalizedBase = pathModule.resolve(baseDir);
  const normalizedTarget = pathModule.resolve(targetPath);
  const relative = pathModule.relative(normalizedBase, normalizedTarget);
  return (
    relative === "" ||
    (!isParentRelativePath(relative, pathModule) && !pathModule.isAbsolute(relative))
  );
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

function advisorPlansDir(): string {
  return path.join(os.homedir(), ".impulse", "advisor-plans");
}

export type SanitizePathOptions = {
  baseDir?: string;
  /** Skip cwd containment (explicit permission or --aa); symlink checks still apply when inside cwd. */
  allowOutsideCwd?: boolean;
};

function sanitizePath(
  filePath: string,
  baseDirOrOptions: string | SanitizePathOptions = process.cwd()
): string {
  const options: SanitizePathOptions =
    typeof baseDirOrOptions === "string"
      ? { baseDir: baseDirOrOptions }
      : baseDirOrOptions;
  const baseDir = options.baseDir ?? process.cwd();
  const allowOutsideCwd = options.allowOutsideCwd === true;

  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(baseDir, filePath);

  const plansBase = path.resolve(advisorPlansDir());
  try {
    const plansReal = realpathOrResolved(plansBase);
    const targetResolved = resolveWithExistingAncestors(resolved);
    if (isWithinBase(plansReal, targetResolved)) {
      return targetResolved;
    }
  } catch {
    // plans dir may not exist yet
  }

  if (allowOutsideCwd) {
    return resolveWithExistingAncestors(resolved);
  }

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

export { sanitizePath, SecurityError, isWithinBase };
