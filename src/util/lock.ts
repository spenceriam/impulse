import fs from "fs/promises";
import path from "path";

type LockMode = "read" | "write";

interface Disposable {
  [Symbol.dispose](): void;
}

interface AsyncDisposable extends Disposable {
  [Symbol.asyncDispose](): Promise<void>;
}

function lockPath(target: string, mode: LockMode): string {
  const ext = mode === "read" ? ".rlock" : ".wlock";
  return path.join(path.dirname(target), path.basename(target) + ext);
}

class LockImpl implements AsyncDisposable {
  private readonly lockFile: string;

  constructor(lockFile: string) {
    this.lockFile = lockFile;
  }

  [Symbol.dispose](): void {
    fs.unlink(this.lockFile).catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw e;
      }
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    try {
      await fs.unlink(this.lockFile);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw e;
      }
    }
  }
}

export namespace Lock {
  const acquireLock = async (lockFile: string, mode: LockMode, timeout: number = 5000): Promise<void> => {
    const startTime = Date.now();

    while (true) {
      try {
        const content = mode === "read" ? "read" : `write:${process.pid}`;
        await fs.writeFile(lockFile, content, { flag: "wx" });
        return;
      } catch (e) {
        const error = e as NodeJS.ErrnoException;
        if (error.code === "EEXIST") {
          if (Date.now() - startTime > timeout) {
            throw new Error(`Lock timeout: ${lockFile}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        } else {
          throw e;
        }
      }
    }
  };

  export const read = async (target: string): Promise<LockImpl> => {
    const lockFile = lockPath(target, "read");
    await acquireLock(lockFile, "read");
    return new LockImpl(lockFile);
  };

  export const write = async (target: string): Promise<LockImpl> => {
    const lockFile = lockPath(target, "write");
    await acquireLock(lockFile, "write");
    return new LockImpl(lockFile);
  };
}
