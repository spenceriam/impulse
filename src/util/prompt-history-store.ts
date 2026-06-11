import * as fs from "fs/promises";
import * as path from "path";
import { Global } from "../global.js";
import { getCurrentProjectID } from "../session/store.js";

const DEFAULT_HISTORY_DIR = path.join(Global.Path.home, "history");

function historyPath(projectID: string, baseDir?: string): string {
  return path.join(baseDir ?? DEFAULT_HISTORY_DIR, `${projectID}.json`);
}

export async function loadPromptHistory(opts?: {
  projectID?: string;
  baseDir?: string;
}): Promise<string[]> {
  const projectID = opts?.projectID ?? getCurrentProjectID();
  const file = historyPath(projectID, opts?.baseDir);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    return [];
  }
}

export async function savePromptHistory(
  entries: string[],
  opts?: { projectID?: string; baseDir?: string }
): Promise<void> {
  const projectID = opts?.projectID ?? getCurrentProjectID();
  const dir = opts?.baseDir ?? DEFAULT_HISTORY_DIR;
  const file = historyPath(projectID, opts?.baseDir);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), "utf-8");
  await fs.rename(tmp, file);
}
