import { Global } from "../global";
import fs from "fs/promises";
import path from "path";
import { writeJsonAtomic } from "../util/atomic-write.js";

class NotFoundErrorImpl extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export namespace Storage {
  export const NotFoundError = NotFoundErrorImpl;

  function keyToPath(key: string[]): string {
    if (key[0] === "session" && key.length >= 3) {
      const [, projectID, sessionID] = key;
      return path.join(Global.Path.sessions, projectID!, `${sessionID}.json`);
    }
    const storageDir = path.join(Global.Path.data, "storage");
    return path.join(storageDir, ...key) + ".json";
  }

  function legacyKeyToPath(key: string[]): string | null {
    if (key[0] === "session" && key.length >= 3) {
      const [, projectID, sessionID] = key;
      return path.join(
        Global.Path.legacyData,
        "storage",
        "session",
        projectID!,
        `${sessionID}.json`
      );
    }
    return null;
  }

  export async function read<T>(key: string[]): Promise<T> {
    const target = keyToPath(key);

    try {
      const content = await fs.readFile(target, "utf-8");
      return JSON.parse(content) as T;
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        const legacy = legacyKeyToPath(key);
        if (legacy) {
          try {
            const content = await fs.readFile(legacy, "utf-8");
            return JSON.parse(content) as T;
          } catch (legacyErr) {
            const le = legacyErr as NodeJS.ErrnoException;
            if (le.code !== "ENOENT") throw legacyErr;
          }
        }
        throw new NotFoundError(`Resource not found: ${target}`);
      }
      throw error;
    }
  }

  export async function write<T>(key: string[], content: T): Promise<void> {
    const target = keyToPath(key);
    await writeJsonAtomic(target, content);
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
    try {
      await fs.unlink(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  async function listDir(
    dirPath: string,
    prefix: string[],
    keys: string[][]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        const entryPath = path.join(dirPath, entry.name);
        const newKey = [...prefix, entry.name];

        if (entry.isDirectory()) {
          await listDir(entryPath, newKey, keys);
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
  }

  export async function list(prefix: string[]): Promise<string[][]> {
    const keys: string[][] = [];
    const seen = new Set<string>();

    const addKey = (key: string[]) => {
      const sig = key.join("/");
      if (!seen.has(sig)) {
        seen.add(sig);
        keys.push(key);
      }
    };

    if (prefix[0] === "session") {
      const sessionsRoot = Global.Path.sessions;
      const legacyRoot = path.join(
        Global.Path.legacyData,
        "storage",
        "session"
      );
      const subPrefix = prefix.slice(1);

      if (subPrefix.length === 0) {
        for (const root of [sessionsRoot, legacyRoot]) {
          try {
            const projects = await fs.readdir(root, { withFileTypes: true });
            for (const p of projects) {
              if (!p.isDirectory() || p.name.startsWith(".")) continue;
              const projectPath = path.join(root, p.name);
              const acc: string[][] = [];
              await listDir(projectPath, ["session", p.name], acc);
              for (const k of acc) addKey(k);
            }
          } catch {
            // missing root
          }
        }
      } else {
        const projectPath = path.join(sessionsRoot, ...subPrefix);
        const acc: string[][] = [];
        await listDir(projectPath, ["session", ...subPrefix], acc);
        for (const k of acc) addKey(k);

        const legacyPath = path.join(legacyRoot, ...subPrefix);
        const accLegacy: string[][] = [];
        await listDir(legacyPath, ["session", ...subPrefix], accLegacy);
        for (const k of accLegacy) addKey(k);
      }
      return keys;
    }

    const storageDir = path.join(Global.Path.data, "storage");
    const prefixPath = path.join(storageDir, ...prefix);
    await listDir(prefixPath, prefix, keys);
    return keys;
  }
}
