/**
 * One user `!command` run in the chat transcript (history per command).
 */

import { wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER, gutterContent, innerWidth, truncateGutterLine } from "../gutter.js";
import { formatDurationMs } from "../format-helpers.js";
import { shellTakeoverHint } from "../shell-shortcuts.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const SPINNER = ["··●", "·●·", "●··", "·●·"];
let spinFrame = 0;

const MAX_BODY_LINES = 24;

export type ShellBlockPhase = "running" | "done" | "cancelled";

export class ShellCommandBlock implements Component {
  private phase: ShellBlockPhase = "running";
  private command = "";
  private output = "";
  private exitCode: number | null = null;
  private durationMs = 0;
  private showTakeoverHint = false;
  private takeoverActive = false;

  constructor(command: string) {
    this.command = command;
  }

  appendOutput(chunk: string): void {
    this.output += chunk;
  }

  setDone(exitCode: number, durationMs: number): void {
    this.phase = "done";
    this.exitCode = exitCode;
    this.durationMs = durationMs;
  }

  setCancelled(): void {
    this.phase = "cancelled";
    this.exitCode = -1;
  }

  setInteractiveHint(show: boolean): void {
    this.showTakeoverHint = show;
  }

  setTakeoverActive(active: boolean): void {
    this.takeoverActive = active;
  }

  isRunning(): boolean {
    return this.phase === "running";
  }

  invalidate(): void {
    spinFrame = (spinFrame + 1) % SPINNER.length;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const inner = innerWidth(width);

    if (this.phase === "running") {
      const sp = yellow(SPINNER[spinFrame]!);
      lines.push(
        truncateGutterLine(`${GUTTER}${sp} ${cyan("!")} ${dim(this.command)}`, width)
      );
    } else if (this.phase === "cancelled") {
      lines.push(
        truncateGutterLine(`${GUTTER}${red("✗")} ${cyan("!")} ${dim(this.command)}`, width)
      );
    } else {
      const icon = this.exitCode === 0 ? green("✓") : red("✗");
      const dur = dim(formatDurationMs(this.durationMs));
      lines.push(
        truncateGutterLine(
          `${GUTTER}${icon} ${cyan("!")} ${dim(this.command)}  ${dur}`,
          width
        )
      );
    }

    lines.push(gutterContent(dim("─".repeat(Math.min(inner, 40))), width));

    const bodyLines = stripAnsi(this.output).split("\n");
    const tail = bodyLines.slice(-MAX_BODY_LINES);
    for (const raw of tail) {
      if (raw.length === 0) {
        lines.push(gutterContent("", width));
        continue;
      }
      for (const wl of wrapTextWithAnsi(raw, inner)) {
        lines.push(gutterContent(wl, width));
      }
    }

    if (this.showTakeoverHint) {
      const hint = this.takeoverActive
        ? dim(`${shellTakeoverHint()} — typing to shell`)
        : yellow(shellTakeoverHint());
      lines.push(gutterContent(hint, width));
    }

    return lines;
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
