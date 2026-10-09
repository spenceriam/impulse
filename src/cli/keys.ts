/**
 * Kitty-protocol-safe key matching for CLI input handlers.
 *
 * pi-tui enables the kitty keyboard protocol (flags 1|2|4) in terminals that
 * answer its `\x1b[?u` query — Foot, Alacritty, Ghostty, kitty, WezTerm, iTerm2.
 * Under that protocol, Esc, Ctrl+C and the arrows arrive as CSI-u sequences
 * (e.g. `\x1b[27u`, `\x1b[99;5u`, `\x1b[1;65A` with lock modifiers) instead
 * of the legacy bytes, so exact-string compares like `data === "\x03"` stop
 * matching and the UI goes keyboard-dead. Route every key decision through
 * these helpers: they wrap pi-tui's `matchesKey`, which understands legacy,
 * kitty CSI-u (with Num/Caps lock bit masking), SS3 and modifyOtherKeys forms.
 *
 * https://github.com/spenceriam/impulse/issues/155
 */
import { isKeyRelease, matchesKey, type KeyId } from "@mariozechner/pi-tui";

function match(data: string, keyId: KeyId): boolean {
  // Kitty event reporting also emits `:3` release events, and input listeners
  // registered via tui.addInputListener run before the TUI's release filter.
  // Never treat a release as a press.
  if (isKeyRelease(data)) return false;
  return matchesKey(data, keyId);
}

export const isEscape = (data: string): boolean => match(data, "escape");
export const isCtrlC = (data: string): boolean => match(data, "ctrl+c");
export const isCtrlD = (data: string): boolean => match(data, "ctrl+d");
export const isCtrlT = (data: string): boolean => match(data, "ctrl+t");
export const isCtrlShiftT = (data: string): boolean => match(data, "ctrl+shift+t");

/** Esc or Ctrl+C — the shared "abort/dismiss" chord in overlays. */
export const isAbortKey = (data: string): boolean => isEscape(data) || isCtrlC(data);

export const isTab = (data: string): boolean => match(data, "tab");
export const isShiftTab = (data: string): boolean => match(data, "shift+tab");

export const isUp = (data: string): boolean => match(data, "up");
export const isDown = (data: string): boolean => match(data, "down");
export const isLeft = (data: string): boolean => match(data, "left");
export const isRight = (data: string): boolean => match(data, "right");

export const isPageUp = (data: string): boolean => match(data, "pageUp");
export const isPageDown = (data: string): boolean => match(data, "pageDown");
export const isHome = (data: string): boolean => match(data, "home");
export const isEnd = (data: string): boolean => match(data, "end");

export const isSpace = (data: string): boolean => match(data, "space");

/**
 * Enter, excluding a lone "\n": with kitty active that byte is Ghostty's
 * shift+enter mapping, and in legacy mode treating it as Enter would break
 * shift+enter line breaks in the prompt.
 */
export const isEnter = (data: string): boolean => data !== "\n" && match(data, "enter");

/**
 * Backspace. Keeps the raw 0x08 form (some terminals/tmux setups send it for
 * plain backspace) alongside the protocol-aware match.
 */
export const isBackspace = (data: string): boolean =>
  data === "\x7f" || data === "\b" || match(data, "backspace");

export const isShiftBackspace = (data: string): boolean =>
  match(data, "shift+backspace");

export const isDelete = (data: string): boolean => match(data, "delete");

export const isShiftDelete = (data: string): boolean => match(data, "shift+delete");
