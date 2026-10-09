/**
 * Shell-mode keyboard chords (platform-aware).
 */
import { isCtrlShiftT, isCtrlT } from "./keys.js";

/** Take over interactive shell stdin */
export function isShellTakeoverChord(data: string): boolean {
  if (data.length < 1) return false;
  // Ctrl+Shift+T (or plain Ctrl+T) in any encoding — raw \x14, legacy ESC
  // forms, kitty CSI-u (macOS Ghostty/iTerm2 speak kitty natively)
  if (isCtrlShiftT(data) || isCtrlT(data)) return true;
  if (process.platform === "darwin") {
    // macOS: ESC + 'T' with modifiers (iTerm/Terminal vary)
    return (
      data === "\x1bT" ||
      data === "\x1b\x54" ||
      data.includes("T") && data.startsWith("\x1b") && data.length <= 6
    );
  }
  return data === "\x1cT";
}

export function shellTakeoverHint(): string {
  return process.platform === "darwin"
    ? "Press Cmd+Shift+T to control"
    : "Press Ctrl+Shift+T to control";
}
