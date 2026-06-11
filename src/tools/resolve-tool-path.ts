import path from "path";
import { sanitizePath, SecurityError } from "../util/path.js";
import { isAllowAllBypass, ask as askPermission } from "../permission/index.js";
import { SessionManager } from "../session/manager.js";

export class OutsideCwdError extends Error {
  constructor(
    readonly filePath: string,
    readonly cwd: string
  ) {
    super(`Blocked: ${filePath} is outside the working directory (${cwd})`);
    this.name = "OutsideCwdError";
  }
}

function isOutsideCwd(targetPath: string, cwd: string): boolean {
  const absoluteTarget = path.resolve(targetPath);
  const absoluteCwd = path.resolve(cwd);
  const relativePath = path.relative(absoluteCwd, absoluteTarget);
  return relativePath.startsWith("..") || path.isAbsolute(relativePath);
}

/**
 * Resolve a tool path with cwd policy: --aa allows outside cwd; otherwise prompt once per directory.
 */
export async function resolveToolPath(
  filePath: string,
  toolName: string,
  baseDir: string = process.cwd()
): Promise<string> {
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(baseDir, filePath);

  if (!isOutsideCwd(resolved, baseDir)) {
    try {
      return sanitizePath(filePath, { baseDir });
    } catch (err) {
      if (err instanceof SecurityError) {
        throw err;
      }
      throw err;
    }
  }

  if (isAllowAllBypass()) {
    return sanitizePath(filePath, { baseDir, allowOutsideCwd: true });
  }

  const sessionID = SessionManager.getCurrentSessionID() ?? "unknown";
  const grantPattern = path.dirname(resolved);

  try {
    await askPermission({
      sessionID,
      permission: "path_outside_cwd",
      patterns: [grantPattern],
      message: `Access path outside working directory: ${resolved}?`,
      metadata: {
        path: resolved,
        cwd: baseDir,
        tool: toolName,
        reason: `Access files outside ${baseDir}`,
      },
    });
    return sanitizePath(filePath, { baseDir, allowOutsideCwd: true });
  } catch {
    throw new OutsideCwdError(filePath, baseDir);
  }
}
