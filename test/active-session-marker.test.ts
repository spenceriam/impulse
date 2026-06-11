import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  clearActiveSessionMarker,
  isActiveSessionMarkerValid,
  readActiveSessionMarker,
  resolveInterruptedSessionResume,
  writeActiveSessionMarker,
  type ActiveSessionMarker,
} from "../src/util/active-session-marker.js";
import { getCurrentProjectID } from "../src/session/store.js";
import { SessionManager } from "../src/session/manager.js";

const DEAD_PID = 999_999_999;

let tmpDir: string;
const createdSessionIds: string[] = [];

function writeRawMarker(overrides: Partial<ActiveSessionMarker>): void {
  const marker: ActiveSessionMarker = {
    sessionId: "sess_test",
    projectID: getCurrentProjectID(),
    cwd: process.cwd(),
    pid: DEAD_PID,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, `${getCurrentProjectID()}.json`),
    JSON.stringify(marker),
    "utf-8"
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-marker-"));
});

afterEach(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  while (createdSessionIds.length > 0) {
    const id = createdSessionIds.pop()!;
    await SessionManager.deleteSession(id);
  }
});

describe("active session marker", () => {
  test("write/read/clear roundtrip", () => {
    writeActiveSessionMarker("sess_abc", { baseDir: tmpDir });
    const marker = readActiveSessionMarker(tmpDir);
    expect(marker?.sessionId).toBe("sess_abc");
    expect(marker?.pid).toBe(process.pid);
    expect(marker?.projectID).toBe(getCurrentProjectID());

    clearActiveSessionMarker(tmpDir);
    expect(readActiveSessionMarker(tmpDir)).toBeUndefined();
  });

  test("marker from our own pid is valid (bun --watch reload reuses the pid)", () => {
    writeActiveSessionMarker("sess_self", { baseDir: tmpDir });
    const marker = readActiveSessionMarker(tmpDir)!;
    expect(isActiveSessionMarkerValid(marker)).toBe(true);
  });

  test("marker from a different live pid is not valid (other instance owns it)", () => {
    // PID 1 (launchd/init) is always alive and never us.
    writeRawMarker({ pid: 1 });
    const marker = readActiveSessionMarker(tmpDir)!;
    expect(isActiveSessionMarkerValid(marker)).toBe(false);
  });

  test("marker with dead pid for this project is valid", () => {
    writeRawMarker({ pid: DEAD_PID });
    const marker = readActiveSessionMarker(tmpDir)!;
    expect(isActiveSessionMarkerValid(marker)).toBe(true);
  });

  test("marker for another project is not valid", () => {
    writeRawMarker({ projectID: "deadbeef", pid: DEAD_PID });
    const marker = readActiveSessionMarker(tmpDir)!;
    expect(isActiveSessionMarkerValid(marker)).toBe(false);
  });

  test("marker for another cwd is not valid", () => {
    writeRawMarker({ cwd: "/somewhere/else", pid: DEAD_PID });
    const marker = readActiveSessionMarker(tmpDir)!;
    expect(isActiveSessionMarkerValid(marker)).toBe(false);
  });

  test("resolve returns session id for interrupted session with content", async () => {
    const session = await SessionManager.createNew("marker-resume-test");
    createdSessionIds.push(session.id);
    await SessionManager.addMessage({
      role: "user",
      content: "hello from interrupted session",
      timestamp: new Date().toISOString(),
    });
    await SessionManager.flushCurrent();

    writeRawMarker({ sessionId: session.id, pid: DEAD_PID });
    const resolved = await resolveInterruptedSessionResume(tmpDir);
    expect(resolved?.sessionId).toBe(session.id);
  });

  test("resolve clears marker and returns undefined for empty session", async () => {
    const session = await SessionManager.createNew("marker-empty-test");
    createdSessionIds.push(session.id);
    await SessionManager.flushCurrent();

    writeRawMarker({ sessionId: session.id, pid: DEAD_PID });
    const resolved = await resolveInterruptedSessionResume(tmpDir);
    expect(resolved).toBeUndefined();
    expect(readActiveSessionMarker(tmpDir)).toBeUndefined();
  });

  test("resolve clears marker for missing session", async () => {
    writeRawMarker({ sessionId: "sess_does_not_exist", pid: DEAD_PID });
    const resolved = await resolveInterruptedSessionResume(tmpDir);
    expect(resolved).toBeUndefined();
    expect(readActiveSessionMarker(tmpDir)).toBeUndefined();
  });
});
