import { randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";

const writeChains = new Map<string, Promise<void>>();

export interface StagedAtomicWrite {
  commit(): Promise<void>;
  /** Promote only when the synchronous predicate still admits this write. */
  commitIf(canCommit: () => boolean): Promise<boolean>;
  rollback(): Promise<void>;
}

interface PreparedAtomicWrite {
  target: string;
  dir: string;
  tmp: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fsyncDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") return;

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch (error) {
    // Directory fsync is not available on every filesystem/platform, but
    // genuine I/O failures must propagate so callers do not claim durability.
    const unsupported = new Set([
      "EACCES",
      "EBADF",
      "EINVAL",
      "EISDIR",
      "ENOTSUP",
      "EOPNOTSUPP",
      "EPERM",
    ]);
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !unsupported.has(code)) throw error;
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
  const prepared = await prepareAtomicWrite(targetPath, content, options);
  try {
    await commitPreparedAtomicWrite(prepared);
  } catch (error) {
    await rollbackPreparedAtomicWrite(prepared).catch(() => {});
    throw error;
  }
}

async function prepareAtomicWrite(
  targetPath: string,
  content: string | Buffer,
  options?: { mode?: number }
): Promise<PreparedAtomicWrite> {
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
    return { target, dir, tmp };
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}

async function commitPreparedAtomicWrite(prepared: PreparedAtomicWrite): Promise<void> {
  await renameWithRetry(prepared.tmp, prepared.target);
  await fsyncDirectory(prepared.dir);
}

async function rollbackPreparedAtomicWrite(prepared: PreparedAtomicWrite): Promise<void> {
  await fs.unlink(prepared.tmp);
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

/** Prepare and fsync a replacement while keeping the target unchanged until commit. */
export async function stageFileAtomic(
  targetPath: string,
  content: string | Buffer,
  options?: { mode?: number }
): Promise<StagedAtomicWrite> {
  const target = path.resolve(targetPath);
  const previous = writeChains.get(target) ?? Promise.resolve();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const reservation = previous.catch(() => {}).then(() => gate);
  writeChains.set(target, reservation);

  const release = () => {
    releaseGate();
    if (writeChains.get(target) === reservation) writeChains.delete(target);
  };

  await previous.catch(() => {});
  let prepared: PreparedAtomicWrite;
  try {
    prepared = await prepareAtomicWrite(target, content, options);
  } catch (error) {
    release();
    throw error;
  }

  let settled = false;
  const promote = async (canCommit?: () => boolean): Promise<boolean> => {
    if (settled) throw new Error("Atomic write stage already settled");
    if (canCommit && !canCommit()) {
      try {
        await rollbackPreparedAtomicWrite(prepared);
      } finally {
        settled = true;
        release();
      }
      return false;
    }

    // The predicate above is deliberately synchronous and immediately
    // adjacent to starting the rename. Callers hold their mutation lease
    // across this method so replacement handoff cannot overtake promotion.
    await commitPreparedAtomicWrite(prepared);
    settled = true;
    release();
    return true;
  };
  return {
    async commit() {
      await promote();
    },
    async commitIf(canCommit) {
      return promote(canCommit);
    },
    async rollback() {
      if (settled) return;
      try {
        await rollbackPreparedAtomicWrite(prepared);
      } finally {
        settled = true;
        release();
      }
    },
  };
}

export async function stageJsonAtomic(
  targetPath: string,
  value: unknown
): Promise<StagedAtomicWrite> {
  return stageFileAtomic(targetPath, JSON.stringify(value, null, 2), { mode: 0o600 });
}
