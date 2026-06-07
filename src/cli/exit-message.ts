/**
 * Post-TUI exit messages on stdout.
 */

import { writeSync } from "fs";
import {
  collectSessionStats,
  formatSessionStatsBlock,
} from "../session/session-stats.js";
import type { Session } from "../session/store.js";
import { prefixStdoutSublineLines, printStdoutLogo } from "./welcome-banner.js";

export function clearScreenAndHome(): void {
  writeSync(1, "\x1b[2J\x1b[H");
}

export type SessionExitInfo = {
  id: string;
  title: string;
  model?: string;
};

export function formatSessionExitMessage(
  session: SessionExitInfo,
  opts?: { includeStats?: boolean; session?: Session }
): string {
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

  if (opts?.includeStats && opts.session) {
    lines.push("");
    lines.push(...formatSessionStatsBlock(collectSessionStats(opts.session)));
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

export function printSessionExitMessage(
  session: SessionExitInfo,
  opts?: { includeStats?: boolean; fullSession?: Session }
): void {
  clearScreenAndHome();
  printStdoutLogo();
  writeSync(
    1,
    prefixStdoutSublineLines(
      formatSessionExitMessage(
        session,
        opts?.includeStats !== undefined || opts?.fullSession !== undefined
          ? {
              ...(opts?.includeStats !== undefined ? { includeStats: opts.includeStats } : {}),
              ...(opts?.fullSession !== undefined ? { session: opts.fullSession } : {}),
            }
          : undefined
      )
    ) + "\n"
  );
}
