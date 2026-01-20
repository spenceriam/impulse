import path from "path";
import fs from "fs";

class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

function sanitizePath(filePath: string, baseDir: string = process.cwd()): string {
  const resolved = path.resolve(baseDir, filePath);
  const normalizedBaseDir = path.resolve(baseDir);

  if (!resolved.startsWith(normalizedBaseDir)) {
    throw new SecurityError(`Path traversal detected: ${filePath}`);
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    realPath = resolved;
  }

  const realBaseDir = path.resolve(baseDir);

  if (!realPath.startsWith(realBaseDir)) {
    throw new SecurityError(`Symlink bypass detected: ${filePath}`);
  }

  return realPath;
}

export { sanitizePath, SecurityError };
