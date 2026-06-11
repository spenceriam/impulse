/**
 * Active-session lifecycle marker (issue #78).
 *
 * Generalizes the /update resume hint to all abrupt restarts: dev watch
 * reloads (bun --watch restarting after a git branch switch), crashes, and
 * kills. The marker is written while a session is live and deleted on clean
 * exit — so its presence at startup means the previous process died with a
 * session open, and that session should be auto-resumed.
 */

import * as fs from "fs";
import * as path from "path";
import { Global } from "../global.js";
import { getCurrentProjectID } from "../session/store.js";

export interface ActiveSessionMarker {
  sessionId: string;
  projectID: string;
  cwd: string;
  pid: number;
  updatedAt: string;
}

const DEFAULT_MARKER_DIR = path.join(Global.Path.config, "active");

function markerPath(baseDir: string, projectID: string): string {
  return path.join(baseDir, `${projectID}.json`);
}

export function writeActiveSessionMarker(
  sessionId: string,
  opts?: { cwd?: string; baseDir?: string }
): void {
  // Tests create real sessions through SessionManager; never let them leave a
  // marker behind that a later real launch would auto-resume.
  if (!opts?.baseDir && process.env.NODE_ENV === "test") return;
  try {
    const marker: ActiveSessionMarker = {
      sessionId,
      projectID: getCurrentProjectID(),
      cwd: opts?.cwd ?? process.cwd(),
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    };
    const dir = opts?.baseDir ?? DEFAULT_MARKER_DIR;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(markerPath(dir, marker.projectID), JSON.stringify(marker, null, 2), "utf-8");
  } catch {
    // Best-effort lifecycle hint — never let it break session flow.
  }
}

export function clearActiveSessionMarker(baseDir?: string): void {
  if (!baseDir && process.env.NODE_ENV === "test") return;
  try {
    fs.unlinkSync(markerPath(baseDir ?? DEFAULT_MARKER_DIR, getCurrentProjectID()));
  } catch {
    // already gone
  }
}

export function readActiveSessionMarker(
  baseDir = DEFAULT_MARKER_DIR
): ActiveSessionMarker | undefined {
  try {
    const raw = fs.readFileSync(markerPath(baseDir, getCurrentProjectID()), "utf-8");
    const parsed = JSON.parse(raw) as ActiveSessionMarker;
    if (!parsed.sessionId?.trim()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but we can't signal it.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Marker belongs to this project + cwd and its owning process is gone —
 * i.e. the session was interrupted, not currently open in another instance.
 */
export function isActiveSessionMarkerValid(marker: ActiveSessionMarker): boolean {
  if (marker.projectID !== getCurrentProjectID()) return false;
  if (marker.cwd && path.resolve(marker.cwd) !== path.resolve(process.cwd())) return false;
  if (marker.pid === process.pid) return false;
  if (pidAlive(marker.pid)) return false;
  return true;
}

/**
 * Startup resolution: returns the interrupted session to auto-resume, or
 * undefined. Clears stale markers pointing at missing/empty sessions.
 */
export async function resolveInterruptedSessionResume(
  baseDir = DEFAULT_MARKER_DIR
): Promise<{ sessionId: string } | undefined> {
  const marker = readActiveSessionMarker(baseDir);
  if (!marker) return undefined;
  if (!isActiveSessionMarkerValid(marker)) return undefined;

  try {
    const { SessionStoreInstance } = await import("../session/store.js");
    const { sessionHasResumeableContent } = await import("../session/session-content.js");
    const session = await SessionStoreInstance.read(marker.sessionId);
    if (!sessionHasResumeableContent(session)) {
      clearActiveSessionMarker(baseDir);
      return undefined;
    }
    return { sessionId: marker.sessionId };
  } catch {
    clearActiveSessionMarker(baseDir);
    return undefined;
  }
}
