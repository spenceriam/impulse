import { describe, expect, test } from "bun:test";
import { clearTerminalForTuiStart } from "../src/cli/terminal-clear.js";

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
});
