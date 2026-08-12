import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  BoundaryPathError,
  buildBubblewrapCommand,
  createIsolatedPreviewBoundary,
  probeBubblewrap,
  type BoundaryOwnedProcess,
} from "../src/execution/boundary.js";

describe("bubblewrap capability and command policy", () => {
  test("is unavailable when platform or capability probe cannot enforce isolation", async () => {
    expect((await probeBubblewrap({ platform: "darwin" })).available).toBe(false);
    const unavailable = await probeBubblewrap({
      platform: "linux",
      findExecutable: async () => "/usr/bin/bwrap",
      runProbe: async () => ({ exitCode: 1, stderr: "user namespaces disabled" }),
    });
    expect(unavailable).toMatchObject({
      available: false,
      backend: "bubblewrap",
    });
    expect(unavailable.reason).toContain("user namespaces disabled");
  });

  test("probes enforcement and builds a network-off, workspace-rooted command", async () => {
    const capability = await probeBubblewrap({
      platform: "linux",
      findExecutable: async () => "/usr/bin/bwrap",
      runProbe: async (argv) => {
        expect(argv).toContain("--unshare-net");
        return { exitCode: 0, stderr: "" };
      },
    });
    expect(capability).toMatchObject({ available: true, backend: "bubblewrap" });

    const argv = buildBubblewrapCommand({
      executable: "/usr/bin/bwrap",
      workspaceRoot: "/tmp/preview/worktree",
      command: ["/bin/bash", "-lc", "echo ok"],
    });
    expect(argv.slice(0, 2)).toEqual(["/usr/bin/bwrap", "--die-with-parent"]);
    expect(argv).toContain("--unshare-net");
    expect(argv).toContain("--clearenv");
    expect(argv).toContain("/tmp/preview/worktree");
    expect(argv.join(" ")).not.toContain(process.cwd());
  });
});

describe("isolated preview boundary", () => {
  test("runs through a genuinely available bubblewrap backend", async () => {
    const capability = await probeBubblewrap();
    if (!capability.available) return;
    const root = await mkdtemp(join(tmpdir(), "impulse-bwrap-real-"));
    try {
      const boundary = await createIsolatedPreviewBoundary({ workspaceRoot: root, capability });
      const result = await boundary.run(["/bin/bash", "-lc", "printf isolated > actual.txt"]);
      expect(result.exitCode).toBe(0);
      expect(await readFile(join(root, "actual.txt"), "utf8")).toBe("isolated");
      expect(await boundary.cleanup()).toEqual({ ok: true, stopped: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects lexical and symlink path escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "impulse-boundary-"));
    const outside = await mkdtemp(join(tmpdir(), "impulse-outside-"));
    try {
      await mkdir(join(root, "src"));
      await symlink(outside, join(root, "escape"));
      const boundary = await createIsolatedPreviewBoundary({
        workspaceRoot: root,
        capability: { available: true, backend: "bubblewrap", executable: "/usr/bin/bwrap" },
        spawn: () => { throw new Error("unused"); },
      });
      expect(await boundary.resolvePath("src/new.ts", "write")).toBe(join(root, "src/new.ts"));
      await expect(boundary.resolvePath("../outside", "write")).rejects.toBeInstanceOf(BoundaryPathError);
      await expect(boundary.resolvePath("escape/file", "write")).rejects.toBeInstanceOf(BoundaryPathError);
      await expect(boundary.resolvePath(".git/config", "write")).rejects.toBeInstanceOf(BoundaryPathError);
      await expect(boundary.resolvePath(".impulse/state.json", "write")).rejects.toBeInstanceOf(BoundaryPathError);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("owns subprocesses and confirms cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "impulse-boundary-"));
    let killed = false;
    let release!: () => void;
    const exited = new Promise<number>((resolve) => { release = () => resolve(143); });
    const process: BoundaryOwnedProcess = {
      pid: 42,
      exited,
      async kill() { killed = true; release(); },
    };
    try {
      const boundary = await createIsolatedPreviewBoundary({
        workspaceRoot: root,
        capability: { available: true, backend: "bubblewrap", executable: "/usr/bin/bwrap" },
        spawn: () => process,
      });
      const running = boundary.run(["/bin/bash", "-lc", "sleep 20"]);
      const cleaned = await boundary.cleanup();
      expect(cleaned).toEqual({ ok: true, stopped: 1 });
      expect(killed).toBe(true);
      await running;
      await expect(boundary.run(["/bin/true"])).rejects.toThrow("closed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails closed instead of spawning when unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "impulse-boundary-"));
    let spawned = false;
    try {
      await expect(createIsolatedPreviewBoundary({
        workspaceRoot: root,
        capability: { available: false, backend: "bubblewrap", reason: "disabled", remediation: "Enable unprivileged user namespaces." },
        spawn: () => { spawned = true; throw new Error("must not spawn"); },
      })).rejects.toThrow("disabled");
      expect(spawned).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
