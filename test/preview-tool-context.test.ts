import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { runWithExecutionContext } from "../src/execution/context.js";
import type { ExecutionBoundary } from "../src/execution/boundary.js";
import { Tool } from "../src/tools/registry.js";
import "../src/tools/file-write.js";
import "../src/tools/bash.js";
import "../src/tools/file-read.js";
import "../src/tools/glob.js";
import "../src/tools/ls.js";
import { setCurrentMode } from "../src/tools/mode-state.js";
import {
  configureApprovalPolicy,
  effectiveApprovalPolicy,
  resetApprovalPolicyForTests,
} from "../src/permission/policy.js";

describe("mode, approval, and execution boundary independence", () => {
  test("ASK preview writes stay rooted and shell runs only through boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "impulse-preview-tools-"));
    const commands: string[][] = [];
    const boundary: ExecutionBoundary = {
      descriptor: { kind: "isolated-preview", label: "PREVIEW", workspaceRoot: root, backend: "bubblewrap", network: "off" },
      async resolvePath(input) {
        const target = resolve(root, input);
        if (target !== root && !target.startsWith(`${root}/`)) throw new Error("outside preview");
        return target;
      },
      async run(command) { commands.push(command); return { exitCode: 0, stdout: "sandboxed", stderr: "" }; },
      async cleanup() { return { ok: true, stopped: 0 }; },
    };
    try {
      setCurrentMode("ASK");
      configureApprovalPolicy({ persisted: "allow-all" });
      const results = await runWithExecutionContext({ cwd: root, boundary }, async () => ({
        write: await Tool.execute("file_write", { filePath: "safe.txt", content: "preview\n" }),
        escape: await Tool.execute("file_write", { filePath: "../escape.txt", content: "no\n" }),
        bash: await Tool.execute("bash", { command: "printf ok", description: "test boundary" }),
        read: await Tool.execute("file_read", { filePath: "safe.txt" }),
        glob: await Tool.execute("glob", { pattern: "*.txt" }),
        ls: await Tool.execute("ls", {}),
      }));
      expect(results.write.success).toBe(true);
      expect(await readFile(join(root, "safe.txt"), "utf8")).toBe("preview\n");
      expect(results.escape.success).toBe(false);
      expect(results.bash.output).toBe("sandboxed");
      expect(commands).toEqual([["/bin/bash", "-lc", "printf ok"]]);
      expect(results.read.output).toContain("preview");
      expect(results.glob.output).toContain("safe.txt");
      expect(results.ls.output).toContain("safe.txt");
      expect(effectiveApprovalPolicy()).toBe("allow-all");
    } finally {
      resetApprovalPolicyForTests();
      await rm(root, { recursive: true, force: true });
    }
  });
});
