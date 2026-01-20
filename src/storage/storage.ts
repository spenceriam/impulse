import { Global } from "../global";
import fs from "fs/promises";
import path from "path";

class NotFoundErrorImpl extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export namespace Storage {
  export const NotFoundError = NotFoundErrorImpl;

  function keyToPath(key: string[]): string {
    const storageDir = path.join(Global.Path.data, "storage");
    return path.join(storageDir, ...key) + ".json";
  }

  export async function read<T>(key: string[]): Promise<T> {
    const target = keyToPath(key);

    try {
      const content = await fs.readFile(target, "utf-8");
      return JSON.parse(content) as T;
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        throw new NotFoundError(`Resource not found: ${target}`);
      }
      throw error;
    }
  }

  export async function write<T>(key: string[], content: T): Promise<void> {
    const target = keyToPath(key);
    const dir = path.dirname(target);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(target, JSON.stringify(content, null, 2), "utf-8");
  }

  export async function update<T>(
    key: string[],
    fn: (draft: T) => void
  ): Promise<T> {
    const current = await read<T>(key);
    fn(current);
    await write(key, current);
    return current;
  }

  export async function remove(key: string[]): Promise<void> {
    const target = keyToPath(key);
    await fs.unlink(target);
  }

  export async function list(prefix: string[]): Promise<string[][]> {
    const storageDir = path.join(Global.Path.data, "storage");
    const prefixPath = path.join(storageDir, ...prefix);
    const keys: string[][] = [];

    const walkDir = async (dirPath: string, currentKey: string[]) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;

          const entryPath = path.join(dirPath, entry.name);
          const newKey = [...currentKey, entry.name];

          if (entry.isDirectory()) {
            await walkDir(entryPath, newKey);
          } else if (entry.isFile() && entry.name.endsWith(".json")) {
            const keyWithoutJson = [...newKey];
            keyWithoutJson[keyWithoutJson.length - 1] = entry.name.slice(0, -5);
            keys.push(keyWithoutJson);
          }
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }
    };

    await walkDir(prefixPath, prefix);
    return keys;
  }
}
