import { randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";

const writeChains = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fsyncDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") return;

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch {
    // Directory fsync is not available on every filesystem/platform.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function renameWithRetry(tmp: string, target: string): Promise<void> {
  const retryable = new Set(["EBUSY", "EACCES", "EPERM"]);
  let lastError: unknown;

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rename(tmp, target);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || !code || !retryable.has(code)) {
        throw error;
      }
      await sleep(25 * (attempt + 1));
    }
  }

  throw lastError;
}

async function writeFileAtomicUnchained(
  targetPath: string,
  content: string | Buffer,
  options?: { mode?: number }
): Promise<void> {
  const target = path.resolve(targetPath);
  const dir = path.dirname(target);
  const base = path.basename(target);
  const suffix = `${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}`;
  const tmp = path.join(dir, `.${base}.${suffix}.tmp`);

  await fs.mkdir(dir, { recursive: true });

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, "wx", options?.mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;

    await renameWithRetry(tmp, target);
    await fsyncDirectory(dir);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}

export async function writeFileAtomic(
  targetPath: string,
  content: string | Buffer,
  options?: { mode?: number }
): Promise<void> {
  const target = path.resolve(targetPath);
  const previous = writeChains.get(target) ?? Promise.resolve();
  const next = previous
    .catch(() => {
      // Keep the chain alive after a previous failed write.
    })
    .then(() => writeFileAtomicUnchained(target, content, options));

  writeChains.set(target, next);
  try {
    await next;
  } finally {
    if (writeChains.get(target) === next) {
      writeChains.delete(target);
    }
  }
}

export async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  await writeFileAtomic(targetPath, JSON.stringify(value, null, 2), { mode: 0o600 });
}
