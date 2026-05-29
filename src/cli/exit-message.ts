/**
 * Post-TUI exit messages on stdout.
 */

import { writeSync } from "fs";
import { prefixStdoutSublineLines, printStdoutLogo } from "./welcome-banner.js";

export function clearScreenAndHome(): void {
  writeSync(1, "\x1b[2J\x1b[H");
}

export type SessionExitInfo = {
  id: string;
  title: string;
  model?: string;
};

export function formatSessionExitMessage(session: SessionExitInfo): string {
  const title = session.title.trim() || "Untitled session";
  const lines = [
    "Thanks for using impulse.",
    "Your session has been saved.",
    "",
    `Session: "${title}"`,
    `Session ID: ${session.id}`,
  ];
  if (session.model?.trim()) {
    lines.push(`Model: ${session.model.trim()}`);
  }
  lines.push(
    "",
    "From your terminal:",
    `  impulse --resume ${session.id}`,
    "",
    "When impulse is already running:",
    `  /resume ${session.id}`,
    "  (or /resume to open the session picker)",
    ""
  );
  return lines.join("\n");
}

export function printSessionExitMessage(session: SessionExitInfo): void {
  clearScreenAndHome();
  printStdoutLogo();
  writeSync(1, prefixStdoutSublineLines(formatSessionExitMessage(session)) + "\n");
}
