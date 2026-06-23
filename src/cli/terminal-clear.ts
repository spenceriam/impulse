import type { Terminal } from "@mariozechner/pi-tui";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Clear the visible screen and scrollback before pi-tui's first render.
 *
 * pi-tui's initial full render intentionally does not clear, so any pre-TUI
 * startup text remains above the app when the layout is top-anchored.
 */
export function clearTerminalForTuiStart(terminal: Pick<Terminal, "write">): void {
  terminal.write("\x1b[2J\x1b[H\x1b[3J");
}

/**
 * pi-tui's PI_DEBUG_REDRAW logger writes to ~/.pi/agent/pi-debug.log but does
 * not create the directory first. Ensure it exists before the first render.
 */
export function piTuiDebugRedrawDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".pi", "agent");
}

export function ensurePiTuiDebugRedrawDir(homeDir = os.homedir()): void {
  if (process.env["PI_DEBUG_REDRAW"] !== "1") return;
  fs.mkdirSync(piTuiDebugRedrawDir(homeDir), { recursive: true });
}
