import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildDebugInstrumentationNudge } from "../src/agent/debug-nudge.js";

describe("debug instrumentation nudge", () => {
  test("returns undefined when no markers remain", () => {
    const dir = mkdtempSync(join(tmpdir(), "impulse-debug-"));
    const file = join(dir, "clean.ts");
    writeFileSync(file, "export const x = 1;\n");
    expect(buildDebugInstrumentationNudge([file], dir)).toBeUndefined();
  });

  test("flags files that still contain IMPULSE_DEBUG", () => {
    const dir = mkdtempSync(join(tmpdir(), "impulse-debug-"));
    const file = join(dir, "dirty.ts");
    writeFileSync(file, 'console.error("[IMPULSE_DEBUG] probe");\n');
    const nudge = buildDebugInstrumentationNudge(["dirty.ts"], dir);
    expect(nudge).toContain("[IMPULSE_DEBUG]");
    expect(nudge).toContain("dirty.ts");
  });
});
