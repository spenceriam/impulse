/**
 * Fixed welcome header: FIGlet Slant logo, meta line, keyboard hints.
 */

import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { GUTTER, GUTTER_WIDTH, innerWidth } from "./gutter.js";

/** FIGlet Slant output for "impulse" (frozen at generation time). */
export const IMPULSE_SLANT_LOGO: readonly string[] = [
  "    _                       __        ",
  "   (_)___ ___  ____  __  __/ /_______ ",
  "  / / __ `__ \\/ __ \\/ / / / / ___/ _ \\",
  " / / / / / / / /_/ / /_/ / (__  )  __/",
  "/_/_/ /_/ /_/ .___/\\__,_/_/____/\\___/ ",
  "           /_/                         ",
];

export const WELCOME_HINT =
  "Tab: Change mode (Plan, Debug, etc) | Shift-Tab: Change reason/think | /help for all commands | Esc: Cancel turn | Ctrl+C twice: cancel or exit | /exit to quit impulse";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[38;5;${code}m${s}\x1b[0m`,
};

export function logoDisplayWidth(): number {
  let max = 0;
  for (const line of IMPULSE_SLANT_LOGO) {
    max = Math.max(max, line.length);
  }
  return max;
}

export function shouldUseAsciiLogo(terminalCols: number): boolean {
  return terminalCols - GUTTER_WIDTH >= logoDisplayWidth() + 2;
}

/** White bold FIGlet line (no gutter). */
export function formatLogoLine(line: string): string {
  return `${A.bold}${A.fg(255, line)}${A.reset}`;
}

export function welcomeMetaText(version: string): string {
  return `cli coding agent | v${version}`;
}

/** Dim meta line (no gutter). */
export function formatWelcomeMeta(version: string): string {
  return `${A.dim}${welcomeMetaText(version)}${A.reset}`;
}

/** Wrap keyboard hints; each line is truncated to full terminal width (gutter + dim text). */
export function renderWelcomeHintLines(width: number): string[] {
  const contentWidth = Math.max(8, innerWidth(width));
  return wrapTextWithAnsi(WELCOME_HINT, contentWidth).map((line) =>
    truncateToWidth(`${GUTTER}${A.dim}${line}${A.reset}`, width)
  );
}

/** @deprecated Prefer WelcomeHintBlock in the TUI; kept for tests. */
export function formatWelcomeHintLines(terminalCols: number): string[] {
  return renderWelcomeHintLines(terminalCols);
}
