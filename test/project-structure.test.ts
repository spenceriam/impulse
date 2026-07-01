import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import {
  buildProjectStructureProbe,
  clearProjectStructureCache,
  formatProjectStructureBlock,
  probeProjectStructure,
} from "../src/agent/project-structure.js";

describe("buildProjectStructureProbe", () => {
  test("returns null for an empty file list", () => {
    expect(buildProjectStructureProbe([])).toBeNull();
  });

  test("returns null when the scanned file count is too large", () => {
    const huge = Array.from({ length: 20_001 }, (_, i) => `file${i}.txt`);
    expect(buildProjectStructureProbe(huge)).toBeNull();
  });

  test("groups nested files under directory nodes with recursive counts", () => {
    const probe = buildProjectStructureProbe([
      "src/agent/loop.ts",
      "src/agent/prompts.ts",
      "src/cli/renderer.ts",
      "package.json",
      "README.md",
    ]);

    expect(probe).not.toBeNull();
    expect(probe!.rootLooseFiles).toEqual(["package.json", "README.md"]);
    const src = probe!.root.children.get("src")!;
    expect(src.totalFiles).toBe(3);
    expect(src.children.get("agent")!.totalFiles).toBe(2);
    expect(src.children.get("cli")!.totalFiles).toBe(1);
  });
});

describe("formatProjectStructureBlock", () => {
  test("formats a small tree at the default depth", () => {
    const probe = buildProjectStructureProbe([
      "src/agent/loop.ts",
      "src/cli/renderer.ts",
      "package.json",
    ]);
    const block = formatProjectStructureBlock(probe);

    expect(block).toContain("## Project structure (depth 3, gitignore-respecting)");
    expect(block).toContain("src/");
    expect(block).toContain("agent/ (1 files)");
    expect(block).toContain("package.json");
  });

  test("returns empty string for a null probe", () => {
    expect(formatProjectStructureBlock(null)).toBe("");
  });

  test("backs off to a shallower depth when the tree is too large to render at depth 3", () => {
    // Enough distinct deep subdirectories that depth-3 rendering exceeds the line cap,
    // forcing a back-off to depth 2 (or 1).
    const files = Array.from({ length: 60 }, (_, i) => `src/mod${i}/sub/file.ts`);
    const probe = buildProjectStructureProbe(files);
    const block = formatProjectStructureBlock(probe);

    expect(block).not.toBe("");
    expect(block).toMatch(/## Project structure \(depth [12], gitignore-respecting\)/);
    expect(block.split("\n").length).toBeLessThanOrEqual(41); // header + <=40 body lines
  });
});

describe("probeProjectStructure caching", () => {
  const root = path.join(process.cwd(), `.tmp-project-structure-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "index.ts"), "export {}");
    writeFileSync(path.join(root, "README.md"), "# test");
  });

  afterAll(() => {
    clearProjectStructureCache();
    rmSync(root, { recursive: true, force: true });
  });

  test("caches per cwd and returns the same promise on repeat calls", async () => {
    clearProjectStructureCache();
    const first = probeProjectStructure(root);
    const second = probeProjectStructure(root);
    expect(first).toBe(second);
    const resolved = await first;
    expect(resolved).not.toBeNull();
    expect(resolved!.rootLooseFiles).toContain("README.md");
  });
});
