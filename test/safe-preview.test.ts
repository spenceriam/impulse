import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  PreviewManager,
  type PreviewBoundaryFactory,
} from "../src/preview/manager.js";
import type { ExecutionBoundary } from "../src/execution/boundary.js";
import { probeBubblewrap } from "../src/execution/boundary.js";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(stderr);
  return stdout.trim();
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "impulse-preview-source-"));
  await git(root, "init");
  await writeFile(join(root, "app.txt"), "base\n");
  await git(root, "add", "app.txt");
  await git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "base");
  return root;
}

const fakeBoundary: PreviewBoundaryFactory = async (workspaceRoot) => {
  let cleaned = false;
  const boundary: ExecutionBoundary = {
    descriptor: {
      kind: "isolated-preview",
      label: "PREVIEW",
      workspaceRoot,
      backend: "bubblewrap",
      network: "off",
    },
    async resolvePath(input) { return join(workspaceRoot, input); },
    async run() { return { exitCode: 0, stdout: "", stderr: "" }; },
    async cleanup() { cleaned = true; return { ok: true, stopped: 0 }; },
  };
  return Object.assign(boundary, { wasCleaned: () => cleaned });
};

describe("safe preview", () => {
  test("runs preview mutation through the real sandbox when capability is available", async () => {
    const capability = await probeBubblewrap();
    if (!capability.available) return;
    const source = await tempRepo();
    const manager = new PreviewManager({
      activeWorkspace: source,
      probe: async () => capability,
    });
    try {
      const result = await manager.preview({
        prompt: "append", description: "sandbox integration",
        runner: async ({ boundary, workspacePath }) => {
          const command = await boundary.run(["/bin/bash", "-lc", "printf 'sandbox delta\\n' >> app.txt"], { cwd: workspacePath });
          return { success: command.exitCode === 0, output: command.stderr, summary: ["sandbox command ran"], actions: [] };
        },
      });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error(result.notice);
      expect(result.patch).toContain("+sandbox delta");
      expect(await readFile(join(source, "app.txt"), "utf8")).toBe("base\n");
    } finally {
      await manager.discardAll();
      await rm(source, { recursive: true, force: true });
    }
  });

  test("fails closed before creating a workspace when sandbox is unavailable", async () => {
    const source = await tempRepo();
    const tempParent = await mkdtemp(join(tmpdir(), "impulse-preview-parent-"));
    try {
      const manager = new PreviewManager({
        activeWorkspace: source,
        tempParent,
        probe: async () => ({ available: false, backend: "bubblewrap", reason: "user namespaces disabled", remediation: "Enable user namespaces." }),
      });
      const result = await manager.preview({ prompt: "change app", description: "preview" });
      expect(result.status).toBe("unavailable");
      expect(result.notice).toContain("user namespaces disabled");
      expect((await stat(tempParent)).isDirectory()).toBe(true);
      expect(manager.list()).toHaveLength(0);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(tempParent, { recursive: true, force: true });
    }
  });

  test("preserves dirty baseline and reports only preview-agent delta", async () => {
    const source = await tempRepo();
    await writeFile(join(source, "app.txt"), "base\nuser dirty\n");
    await writeFile(join(source, "untracked.txt"), "user file\n");
    await mkdir(join(source, ".impulse"));
    await writeFile(join(source, ".impulse", "secret.json"), "do not expose\n");
    const manager = new PreviewManager({
      activeWorkspace: source,
      probe: async () => ({ available: true, backend: "bubblewrap", executable: "/usr/bin/bwrap" }),
      boundaryFactory: fakeBoundary,
    });
    try {
      const result = await manager.preview({
        prompt: "change app",
        description: "preview",
        runner: async ({ workspacePath }) => {
          expect(await readFile(join(workspacePath, "app.txt"), "utf8")).toBe("base\nuser dirty\n");
          expect(await readFile(join(workspacePath, "untracked.txt"), "utf8")).toBe("user file\n");
          await expect(stat(join(workspacePath, ".impulse"))).rejects.toThrow();
          await writeFile(join(workspacePath, "app.txt"), "base\nuser dirty\npreview delta\n");
          return { success: true, output: "done", summary: ["changed app"], actions: [] };
        },
      });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error(result.notice);
      expect(result.patch).toContain("+preview delta");
      expect(result.patch).not.toContain("+user dirty");
      expect(result.changedFiles).toEqual(["app.txt"]);
      expect(result.boundary).toEqual({ backend: "bubblewrap", network: "off" });
      expect(result.cleanup.processes).toBe("confirmed");
      expect(await readFile(join(source, "app.txt"), "utf8")).toBe("base\nuser dirty\n");
    } finally {
      await manager.discardAll();
      await rm(source, { recursive: true, force: true });
    }
  });

  test("apply conflicts keep preview; successful apply changes only reviewed files", async () => {
    const source = await tempRepo();
    const manager = new PreviewManager({
      activeWorkspace: source,
      probe: async () => ({ available: true, backend: "bubblewrap", executable: "/usr/bin/bwrap" }),
      boundaryFactory: fakeBoundary,
    });
    try {
      const first = await manager.preview({
        prompt: "change",
        description: "preview",
        runner: async ({ workspacePath }) => {
          await writeFile(join(workspacePath, "app.txt"), "preview\n");
          return { success: true, output: "done", summary: [], actions: [] };
        },
      });
      if (first.status !== "ready") throw new Error(first.notice);
      await writeFile(join(source, "app.txt"), "concurrent\n");
      const conflict = await manager.apply(first.id);
      expect(conflict.ok).toBe(false);
      expect(conflict.status).toBe("conflict");
      expect(await readFile(join(source, "app.txt"), "utf8")).toBe("concurrent\n");
      expect(manager.get(first.id)).toBeDefined();

      await manager.discard(first.id);
      await writeFile(join(source, "app.txt"), "base\n");
      const second = await manager.preview({
        prompt: "change",
        description: "preview",
        runner: async ({ workspacePath }) => {
          await writeFile(join(workspacePath, "app.txt"), "reviewed\n");
          await mkdir(join(workspacePath, "src"), { recursive: true });
          await writeFile(join(workspacePath, "src", "new.ts"), "export {};\n");
          return { success: true, output: "done", summary: [], actions: [] };
        },
      });
      if (second.status !== "ready") throw new Error(second.notice);
      const applied = await manager.apply(second.id);
      expect(applied).toMatchObject({ ok: true, status: "applied" });
      expect(await readFile(join(source, "app.txt"), "utf8")).toBe("reviewed\n");
      expect(await readFile(join(source, "src", "new.ts"), "utf8")).toBe("export {};\n");
      expect(manager.get(second.id)).toBeUndefined();
    } finally {
      await manager.discardAll();
      await rm(source, { recursive: true, force: true });
    }
  });

  test("discard cleans and keep returns recoverable path and cleanup instruction", async () => {
    const source = await tempRepo();
    const manager = new PreviewManager({
      activeWorkspace: source,
      probe: async () => ({ available: true, backend: "bubblewrap", executable: "/usr/bin/bwrap" }),
      boundaryFactory: fakeBoundary,
    });
    try {
      const preview = await manager.preview({
        prompt: "noop", description: "preview",
        runner: async () => ({ success: true, output: "done", summary: [], actions: [] }),
      });
      if (preview.status !== "ready") throw new Error(preview.notice);
      const kept = manager.keep(preview.id);
      expect(kept.path).toBe(preview.workspacePath);
      expect(kept.cleanupCommand).toContain(preview.rootPath);
      expect(manager.get(preview.id)).toBeDefined();
      expect((await manager.discard(preview.id)).ok).toBe(true);
      await expect(stat(preview.rootPath)).rejects.toThrow();
    } finally {
      await manager.discardAll();
      await rm(source, { recursive: true, force: true });
    }
  });

  test("apply rolls back prior writes and retains preview when a write fails", async () => {
    const source = await tempRepo();
    await writeFile(join(source, "other.txt"), "old\n");
    await git(source, "add", "other.txt");
    await git(source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "other");
    let writes = 0;
    const manager = new PreviewManager({
      activeWorkspace: source,
      probe: async () => ({ available: true, backend: "bubblewrap", executable: "/usr/bin/bwrap" }),
      boundaryFactory: fakeBoundary,
      beforeApplyWrite: async () => {
        writes++;
        if (writes === 2) throw new Error("injected apply failure");
      },
    });
    try {
      const preview = await manager.preview({
        prompt: "change two", description: "preview",
        runner: async ({ workspacePath }) => {
          await writeFile(join(workspacePath, "app.txt"), "new app\n");
          await writeFile(join(workspacePath, "other.txt"), "new other\n");
          return { success: true, output: "done", summary: [], actions: [] };
        },
      });
      if (preview.status !== "ready") throw new Error(preview.notice);
      const result = await manager.apply(preview.id);
      expect(result).toMatchObject({ ok: false, status: "rollback" });
      expect(await readFile(join(source, "app.txt"), "utf8")).toBe("base\n");
      expect(await readFile(join(source, "other.txt"), "utf8")).toBe("old\n");
      expect(manager.get(preview.id)).toBeDefined();
    } finally {
      await manager.discardAll();
      await rm(source, { recursive: true, force: true });
    }
  });

  test("apply reports cleanup failure and preserves a recoverable preview", async () => {
    const source = await tempRepo();
    let rootPath = "";
    const manager = new PreviewManager({
      activeWorkspace: source,
      probe: async () => ({ available: true, backend: "bubblewrap", executable: "/usr/bin/bwrap" }),
      boundaryFactory: fakeBoundary,
      removePreviewRoot: async () => { throw new Error("injected cleanup failure"); },
    });
    try {
      const preview = await manager.preview({
        prompt: "change", description: "preview",
        runner: async ({ workspacePath }) => {
          await writeFile(join(workspacePath, "app.txt"), "applied\n");
          return { success: true, output: "done", summary: [], actions: [] };
        },
      });
      if (preview.status !== "ready") throw new Error(preview.notice);
      rootPath = preview.rootPath;
      expect(await manager.apply(preview.id)).toMatchObject({
        ok: false,
        status: "cleanup",
        safeToReturnToAsk: false,
      });
      expect(await readFile(join(source, "app.txt"), "utf8")).toBe("applied\n");
      expect(manager.get(preview.id)).toBeDefined();
    } finally {
      if (rootPath) await rm(rootPath, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });
});
