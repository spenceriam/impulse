import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  clearTerminalForTuiStart,
  ensurePiTuiDebugRedrawDir,
  piTuiDebugRedrawDir,
} from "../src/cli/terminal-clear.js";

describe("clearTerminalForTuiStart", () => {
  test("clears screen, homes cursor, and clears scrollback", () => {
    const writes: string[] = [];

    clearTerminalForTuiStart({
      write(data: string): void {
        writes.push(data);
      },
    });

    expect(writes).toEqual(["\x1b[2J\x1b[H\x1b[3J"]);
  });

  test("creates pi-tui debug redraw directory only when enabled", () => {
    const previous = process.env["PI_DEBUG_REDRAW"];
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-pi-debug-"));
    try {
      delete process.env["PI_DEBUG_REDRAW"];
      ensurePiTuiDebugRedrawDir(tempHome);
      expect(fs.existsSync(piTuiDebugRedrawDir(tempHome))).toBe(false);

      process.env["PI_DEBUG_REDRAW"] = "1";
      ensurePiTuiDebugRedrawDir(tempHome);
      expect(fs.existsSync(piTuiDebugRedrawDir(tempHome))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["PI_DEBUG_REDRAW"];
      else process.env["PI_DEBUG_REDRAW"] = previous;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
