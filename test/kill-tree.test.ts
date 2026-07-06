import { describe, expect, test } from "bun:test";
import { collectDescendants } from "../src/util/process-tree.js";

describe("collectDescendants", () => {
  test("returns direct and nested descendants, deepest-first", () => {
    // Tree: 100 (root) -> 200 -> 300; 100 -> 400 is a sibling of 100, not a child (ppid 1)
    const psOutput = "100 1\n200 100\n300 200\n400 1";
    expect(collectDescendants(psOutput, 100)).toEqual([300, 200]);
  });

  test("returns an empty array for a leaf process", () => {
    const psOutput = "100 1\n200 100";
    expect(collectDescendants(psOutput, 200)).toEqual([]);
  });

  test("returns an empty array when the root has no children", () => {
    const psOutput = "100 1\n200 1\n300 1";
    expect(collectDescendants(psOutput, 100)).toEqual([]);
  });

  test("handles a wide tree (multiple children at the same level)", () => {
    const psOutput = "100 1\n200 100\n300 100\n400 200\n500 300";
    const result = collectDescendants(psOutput, 100);
    // 400 and 500 (grandchildren) must precede 200 and 300 (children) in the result.
    expect(result.indexOf(400)).toBeLessThan(result.indexOf(200));
    expect(result.indexOf(500)).toBeLessThan(result.indexOf(300));
    expect(new Set(result)).toEqual(new Set([200, 300, 400, 500]));
  });

  test("ignores malformed lines", () => {
    const psOutput = "not a pid line\n100 1\n200 100\n\n  \n300 200";
    expect(collectDescendants(psOutput, 100)).toEqual([300, 200]);
  });

  test("does not include the root pid itself or unrelated pids", () => {
    const psOutput = "100 1\n200 100\n999 1\n888 999";
    const result = collectDescendants(psOutput, 100);
    expect(result).not.toContain(100);
    expect(result).not.toContain(999);
    expect(result).not.toContain(888);
  });
});

describe("killProcessTree (POSIX integration)", () => {
  test.skipIf(process.platform === "win32")(
    "kills a real process tree spawned via bash",
    async () => {
      const { killProcessTree } = await import("../src/util/process-tree.js");
      const proc = Bun.spawn({
        cmd: ["bash", "-c", "sleep 30 & sleep 30 & wait"],
        stdout: "ignore",
        stderr: "ignore",
      });
      // Give the child sleeps a moment to actually spawn.
      await new Promise((r) => setTimeout(r, 300));

      await killProcessTree(proc.pid);
      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((r) => setTimeout(() => r(-1), 5000)),
      ]);
      expect(exitCode).not.toBe(-1);

      const ps = Bun.spawn({ cmd: ["ps", "-A", "-o", "pid=,ppid=,command="], stdout: "pipe" });
      const output = await new Response(ps.stdout).text();
      expect(output).not.toContain(String(proc.pid));
    },
    10000
  );
});

describe("killProcessTree (Windows integration)", () => {
  test.skipIf(process.platform !== "win32")(
    "taskkill reaps a cmd.exe process tree (e.g. an npm-run-style child)",
    async () => {
      const { killProcessTree } = await import("../src/util/process-tree.js");
      // cmd.exe spawns a child ping process that outlives a bare proc.kill() on
      // the wrapper — this is the exact shape of the "npm run dev" orphan bug.
      const proc = Bun.spawn({
        cmd: ["cmd", "/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul"],
        stdout: "ignore",
        stderr: "ignore",
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(proc.pid).toBeTruthy();

      await killProcessTree(proc.pid);
      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((r) => setTimeout(() => r(-1), 5000)),
      ]);
      expect(exitCode).not.toBe(-1);

      const tasklist = Bun.spawn({ cmd: ["tasklist", "/FI", "IMAGENAME eq ping.exe"], stdout: "pipe" });
      const output = await new Response(tasklist.stdout).text();
      expect(output).not.toContain("ping.exe");
    },
    10000
  );
});
