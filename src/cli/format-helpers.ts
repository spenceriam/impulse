/**
 * Shared TUI formatting helpers (ASCII-only separators per AGENTS.md).
 */

import { gutterSeparator } from "./gutter.js";

const DIM = "\x1b[2m\x1b[38;5;90m";
const RESET = "\x1b[0m";

/** Dim horizontal rule aligned with gutter layout. */
export function dimRule(terminalWidth: number): string {
  return `${DIM}${gutterSeparator(terminalWidth)}${RESET}`;
}

/** Indented dim rule (e.g. under help section headers). */
export function dimRuleIndented(terminalWidth: number, indent = 2): string {
  const inner = Math.max(8, terminalWidth - indent - 4);
  return `${DIM}${" ".repeat(indent)}${"─".repeat(inner)}${RESET}`;
}
