import fs from "fs/promises";
import path from "path";
import { Global } from "../global";

/**
 * One-time migration from ~/.config/impulse to ~/.impulse.
 * Idempotent: skips items that already exist at the destination.
 */
export async function migrateHomeIfNeeded(): Promise<boolean> {
  let migrated = false;
  const home = Global.Path.home;
  const legacy = Global.Path.legacyData;

  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(Global.Path.sessions, { recursive: true });
  await fs.mkdir(Global.Path.logs, { recursive: true });
  await fs.mkdir(Global.Path.cache, { recursive: true });

  const configDest = path.join(home, "config.json");
  const configSrc = path.join(legacy, "config.json");
  try {
    await fs.access(configDest);
  } catch {
    try {
      await fs.copyFile(configSrc, configDest);
      migrated = true;
    } catch {
      // no legacy config
    }
  }

  const sessionSrc = path.join(legacy, "storage", "session");
  const sessionDest = Global.Path.sessions;
  if (await dirExists(sessionSrc)) {
    if (await copyTreeIfMissing(sessionSrc, sessionDest)) {
      migrated = true;
    }
  }

  for (const sub of ["logs", "crash", "debug"] as const) {
    const src = path.join(legacy, sub);
    const dest = path.join(home, sub);
    if (await dirExists(src)) {
      if (await copyTreeIfMissing(src, dest)) {
        migrated = true;
      }
    }
  }

  return migrated;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Copy src tree into dest; return true if anything was copied. */
async function copyTreeIfMissing(src: string, dest: string): Promise<boolean> {
  let copied = false;
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (await copyTreeIfMissing(from, to)) {
        copied = true;
      }
    } else if (entry.isFile()) {
      if (!(await fileExists(to))) {
        await fs.copyFile(from, to);
        copied = true;
      }
    }
  }
  return copied;
}
