/**
 * Shell-mode keyboard chords (platform-aware).
 */

/** Take over interactive shell stdin */
export function isShellTakeoverChord(data: string): boolean {
  if (data.length < 1) return false;
  // macOS: ESC + 'T' with modifiers (iTerm/Terminal vary); also check common sequences
  if (process.platform === "darwin") {
    return (
      data === "\x1bT" ||
      data === "\x1b\x54" ||
      data.includes("T") && data.startsWith("\x1b") && data.length <= 6
    );
  }
  // Ctrl+Shift+T — \x14 is Ctrl+T; some terminals send ESC sequences
  return data === "\x1cT" || data === "\x14" || data === "\x1b[84;6u";
}

export function shellTakeoverHint(): string {
  return process.platform === "darwin"
    ? "Press Cmd+Shift+T to control"
    : "Press Ctrl+Shift+T to control";
}
