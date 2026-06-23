import type { Terminal } from "@mariozechner/pi-tui";

/**
 * Clear the visible screen and scrollback before pi-tui's first render.
 *
 * pi-tui's initial full render intentionally does not clear, so any pre-TUI
 * startup text remains above the app when the layout is top-anchored.
 */
export function clearTerminalForTuiStart(terminal: Pick<Terminal, "write">): void {
  terminal.write("\x1b[2J\x1b[H\x1b[3J");
}
