/** Shared ANSI styling for pi-tui renderer and overlays. */

export const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

export const clr = {
  user: (s: string) => A.fg(36, s),
  success: (s: string) => A.fg(32, s),
  error: (s: string) => A.fg(31, s),
  warn: (s: string) => A.fg(33, s),
  dim: (s: string) => A.fg(90, s),
  bold: (s: string) => `${A.bold}${s}${A.reset}`,
  tool: (s: string) => A.fg(36, s),
  advisor: (s: string) => A.fg(35, s),
  mode: (s: string) => A.fg(34, s),
  sep: (s: string) => A.fg(90, s),
};

/** Model change feedback without [OK] prefix */
export const modelStatusLine = (message: string) => clr.dim(message);

export const advisorStatusLine = (message: string) => clr.dim(message);

/** ANSI color per mode — used for prompt arrow and context bar mode label */
export const MODE_COLORS: Record<string, number> = {
  AGENT: 34,
  EXPLORE: 32,
  PLAN: 33,
  DEBUG: 31,
};

/** Mode transition in chat (ASCII for Windows/macOS/Linux terminal fonts). */
export const MODE_ARROW = " -> ";
