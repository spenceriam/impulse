import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

const fixture = path.join(process.cwd(), "test/fixtures/fresh-authority-process.ts");

describe("fresh authority initialization", () => {
  test("fresh ASK imports reject mutation while preserving read-only admission", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-fresh-authority-"));
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-fresh-home-"));
    const target = path.join(project, "should-not-exist.txt");
    try {
      const child = Bun.spawn({
        cmd: [process.execPath, fixture, "initial", target],
        cwd: project,
        env: { ...process.env, HOME: isolatedHome },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode, stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        mode: "ASK",
        admission: "ask",
        mutationOpen: false,
        shellError: "Execution is paused while authority or lifecycle cleanup is changing.",
        targetExists: false,
        toolRejected: true,
        mutatingAccepted: false,
        readOnlyAccepted: true,
      });
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  });

  test("only an explicit user transition atomically opens AGENT mutation authority", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-fresh-transition-"));
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-transition-home-"));
    const shellTarget = path.join(project, "agent-shell.txt");
    try {
      const child = Bun.spawn({
        cmd: [process.execPath, fixture, "transition", shellTarget],
        cwd: project,
        env: { ...process.env, HOME: isolatedHome },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode, stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        directAssignment: { mode: "ASK", admission: "ask" },
        modelElevation: {
          changed: false,
          mode: "ASK",
          requestedMode: "AGENT",
          stoppedJobs: 0,
          failedJobIds: ["user-confirmation-required"],
        },
        afterModel: { mode: "ASK", admission: "ask" },
        explicitElevation: {
          changed: true,
          mode: "AGENT",
          stoppedJobs: 0,
          failedJobIds: [],
        },
        elevatedMode: "AGENT",
        elevatedAdmission: "open",
        shellWorked: true,
        toolWorked: true,
        foregroundAccepted: true,
        downgrade: {
          changed: true,
          mode: "ASK",
          stoppedJobs: 0,
          failedJobIds: [],
        },
        finalMode: "ASK",
        finalAdmission: "ask",
        afterDowngradeAccepted: false,
        readOnlyAfterDowngradeAccepted: true,
      });
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  });
});
