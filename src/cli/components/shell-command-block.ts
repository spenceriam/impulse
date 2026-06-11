/**
 * One user `!command` run in the chat transcript (history per command).
 */

import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER, gutterContent, innerWidth, maxLineWidth, truncateGutterLine } from "../gutter.js";
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
const SHELL_CONT_INDENT = GUTTER + "   ";

function wrapShellHeaderLine(
  prefix: string,
  command: string,
  width: number,
  suffix = ""
): string[] {
  const bodyAvail = Math.max(8, maxLineWidth(width) - visibleWidth(prefix));
  const wrapped = wrapTextWithAnsi(command.length > 0 ? command : " ", bodyAvail);
  const lines: string[] = [];
  if (wrapped.length === 0) {
    lines.push(truncateGutterLine(`${prefix}${dim(" ")}`, width));
  } else {
    lines.push(truncateGutterLine(`${prefix}${dim(wrapped[0]!)}`, width));
    const contAvail = Math.max(8, maxLineWidth(width) - visibleWidth(SHELL_CONT_INDENT));
    for (let i = 1; i < wrapped.length; i++) {
      for (const sub of wrapTextWithAnsi(wrapped[i]!, contAvail)) {
        lines.push(truncateGutterLine(`${SHELL_CONT_INDENT}${dim(sub)}`, width));
      }
    }
  }
  if (suffix) {
    const lastIdx = lines.length - 1;
    const last = lines[lastIdx]!;
    const candidate = `${last}${suffix}`;
    if (visibleWidth(candidate) <= maxLineWidth(width)) {
      lines[lastIdx] = truncateGutterLine(candidate, width);
    } else {
      lines.push(truncateGutterLine(`${SHELL_CONT_INDENT}${suffix.trimStart()}`, width));
    }
  }
  return lines;
}

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
        ...wrapShellHeaderLine(`${GUTTER}${sp} ${cyan("!")} `, this.command, width)
      );
    } else if (this.phase === "cancelled") {
      lines.push(
        ...wrapShellHeaderLine(`${GUTTER}${red("✗")} ${cyan("!")} `, this.command, width)
      );
    } else {
      const icon = this.exitCode === 0 ? green("✓") : red("✗");
      const dur = dim(formatDurationMs(this.durationMs));
      lines.push(
        ...wrapShellHeaderLine(
          `${GUTTER}${icon} ${cyan("!")} `,
          this.command,
          width,
          `  ${dur}`
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
