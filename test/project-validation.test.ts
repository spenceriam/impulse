import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { detectValidationCommands } from "../src/util/project-validation.js";

describe("detectValidationCommands", () => {
  test("detects package validation scripts and prefers bun when bun.lock is present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-validation-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          scripts: {
            typecheck: "tsc --noEmit",
            test: "bun test",
            build: "bun run scripts/build.ts",
          },
        })
      );
      fs.writeFileSync(path.join(dir, "bun.lock"), "");

      expect(detectValidationCommands(dir).map((c) => c.command)).toEqual([
        "bun run typecheck",
        "bun run test",
        "bun run build",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
