/**
 * One-shot resume hint written before /update exits so the new process can reload the session.
 */

import * as fs from "fs";
import * as path from "path";
import { Global } from "../global.js";
import { getCurrentProjectID } from "../session/store.js";

export interface UpdateResumeHint {
  sessionId: string;
  projectID: string;
  cwd: string;
  timestamp: string;
}

const HINT_FILE = path.join(Global.Path.config, "last-update-resume.json");

export function writeUpdateResumeHint(sessionId: string, cwd = process.cwd()): void {
  const hint: UpdateResumeHint = {
    sessionId,
    projectID: getCurrentProjectID(),
    cwd,
    timestamp: new Date().toISOString(),
  };
  fs.mkdirSync(Global.Path.config, { recursive: true });
  fs.writeFileSync(HINT_FILE, JSON.stringify(hint, null, 2), "utf-8");
}

export function readUpdateResumeHint(): UpdateResumeHint | undefined {
  try {
    if (!fs.existsSync(HINT_FILE)) return undefined;
    const raw = fs.readFileSync(HINT_FILE, "utf-8");
    const parsed = JSON.parse(raw) as UpdateResumeHint;
    if (!parsed.sessionId?.trim()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function consumeUpdateResumeHint(): UpdateResumeHint | undefined {
  const hint = readUpdateResumeHint();
  if (!hint) return undefined;
  try {
    fs.unlinkSync(HINT_FILE);
  } catch {
    // ignore
  }
  return hint;
}

export function isUpdateResumeHintValid(hint: UpdateResumeHint): boolean {
  const ageMs = Date.now() - Date.parse(hint.timestamp);
  if (!Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) return false;
  if (hint.projectID !== getCurrentProjectID()) return false;
  if (hint.cwd && path.resolve(hint.cwd) !== path.resolve(process.cwd())) return false;
  return true;
}
