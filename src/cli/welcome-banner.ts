/**
 * Welcome header: GEN-tiny block logo, meta line, keyboard hints.
 */

import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { GUTTER, GUTTER_WIDTH, innerWidth } from "./gutter.js";

/** oh-my-logo filled tiny for "impulse" (frozen at generation time). */
export const IMPULSE_GEN_TINY_LOGO: readonly string[] = [
  " █ █▀▄▀█ █▀█ █ █ █   █▀▀ █▀▀",
  " █ █ ▀ █ █▀▀ █▄█ █▄▄ ▄▄█ ██▄",
];

/** TUI logo lines: gutter + 1 (align with prompt band). */
export const WELCOME_LOGO_PREFIX = `${GUTTER} `;

/** TUI meta + hint: logo prefix + 2 (align under "i" stem). */
export const WELCOME_SUBLINE_PREFIX = `${WELCOME_LOGO_PREFIX}  `;

/** Stdout global +1. */
export const STDOUT_PREFIX = " ";

/** Stdout meta / header-band lines: +1 global + 2 under logo. */
export const STDOUT_SUBLINE_PREFIX = "   ";

export const WELCOME_HINT =
  "Tab: Mode (Plan, debug, etc) | Shift-Tab: Change reasoning | /help to see cmds | Esc: Cancel turn | Ctrl+C twice: cancel/exit | /exit to quit";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[38;5;${code}m${s}\x1b[0m`,
};

export function welcomeLogoPrefix(): string {
  return WELCOME_LOGO_PREFIX;
}

export function welcomeSublinePrefix(): string {
  return WELCOME_SUBLINE_PREFIX;
}

export function stdoutPrefix(): string {
  return STDOUT_PREFIX;
}

export function stdoutSublinePrefix(): string {
  return STDOUT_SUBLINE_PREFIX;
}

export function logoDisplayWidth(): number {
  let max = 0;
  for (const line of IMPULSE_GEN_TINY_LOGO) {
    max = Math.max(max, line.length);
  }
  return max;
}

export function shouldUseAsciiLogo(terminalCols: number): boolean {
  return terminalCols - GUTTER_WIDTH >= logoDisplayWidth() + 2;
}

/** White bold logo line (no gutter). */
export function formatLogoLine(line: string): string {
  return `${A.bold}${A.fg(255, line)}${A.reset}`;
}

/** Bold logo lines on stdout (startup / exit). */
export function printStdoutLogo(): void {
  for (const line of IMPULSE_GEN_TINY_LOGO) {
    console.log(`${STDOUT_PREFIX}${A.bold}${line}${A.reset}`);
  }
}

export function welcomeMetaText(version: string): string {
  return `co-partner agent | v${version}`;
}

/** Dim meta line (no gutter). */
export function formatWelcomeMeta(version: string): string {
  return `${A.dim}${welcomeMetaText(version)}${A.reset}`;
}

/** Dim meta for stdout (no ANSI reset bleed). */
export function printWelcomeMeta(version: string): void {
  console.log(`${STDOUT_SUBLINE_PREFIX}${formatWelcomeMeta(version)}`);
}

/** Prefix each line for stdout body text (exit message, etc.). */
export function prefixStdoutSublineLines(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : `${STDOUT_SUBLINE_PREFIX}${line}`))
    .join("\n");
}

/** Wrap keyboard hints; each line is truncated to full terminal width (subline prefix + dim text). */
export function renderWelcomeHintLines(width: number): string[] {
  const contentWidth = Math.max(8, innerWidth(width));
  return wrapTextWithAnsi(WELCOME_HINT, contentWidth).map((line) =>
    truncateToWidth(`${WELCOME_SUBLINE_PREFIX}${A.dim}${line}${A.reset}`, width)
  );
}

/** @deprecated Prefer WelcomeHintBlock in the TUI; kept for tests. */
export function formatWelcomeHintLines(terminalCols: number): string[] {
  return renderWelcomeHintLines(terminalCols);
}
