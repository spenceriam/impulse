/**
 * Embedded terminal panel for ! shell mode (header + output + ghost review zone).
 */

import { wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER, gutterContent, innerWidth, truncateGutterLine } from "../gutter.js";
import { formatDurationMs } from "../format-helpers.js";
import { shellTakeoverHint } from "../shell-shortcuts.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const italic = (s: string) => `\x1b[3m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const SPINNER = ["··●", "·●·", "●··", "·●·"];
let spinFrame = 0;

export type PanelPhase = "idle" | "running" | "done" | "review";

export class TerminalPanel implements Component {
  private phase: PanelPhase = "idle";
  private command = "";
  private exitCode: number | null = null;
  private durationMs = 0;
  private output = "";
  private reviewQuestion = "";
  private reviewText = "";
  private showTakeoverHint = false;
  private takeoverActive = false;
  private maxBodyLines = 16;
  private maxReviewLines = 8;

  setRunning(command: string): void {
    this.phase = "running";
    this.command = command;
    this.exitCode = null;
    this.durationMs = 0;
    this.output = "";
    this.reviewQuestion = "";
    this.reviewText = "";
    this.showTakeoverHint = false;
    this.takeoverActive = false;
  }

  appendOutput(chunk: string): void {
    this.output += chunk;
  }

  setDone(exitCode: number, durationMs: number): void {
    this.phase = "done";
    this.exitCode = exitCode;
    this.durationMs = durationMs;
  }

  setInteractiveHint(show: boolean): void {
    this.showTakeoverHint = show;
  }

  setTakeoverActive(active: boolean): void {
    this.takeoverActive = active;
  }

  startReview(question: string): void {
    this.phase = "review";
    this.reviewQuestion = question;
    this.reviewText = "";
  }

  appendReview(chunk: string): void {
    this.reviewText += chunk;
  }

  clearReview(): void {
    this.reviewQuestion = "";
    this.reviewText = "";
    if (this.phase === "review") this.phase = "done";
  }

  reset(): void {
    this.phase = "idle";
    this.command = "";
    this.output = "";
    this.reviewQuestion = "";
    this.reviewText = "";
    this.exitCode = null;
    this.showTakeoverHint = false;
    this.takeoverActive = false;
  }

  isActive(): boolean {
    return this.phase !== "idle";
  }

  invalidate(): void {
    spinFrame = (spinFrame + 1) % SPINNER.length;
  }

  render(width: number): string[] {
    if (this.phase === "idle") return [];

    const lines: string[] = [];
    const inner = innerWidth(width);
    const rule = dim("─".repeat(Math.min(inner, 40)));

    if (this.phase === "running") {
      const sp = yellow(SPINNER[spinFrame]!);
      lines.push(truncateGutterLine(`${GUTTER}${sp} ${cyan("shell")}  ${dim(this.command)}`, width));
    } else {
      const icon = this.exitCode === 0 ? green("✓") : red("✗");
      const dur = dim(formatDurationMs(this.durationMs));
      lines.push(
        truncateGutterLine(`${GUTTER}${icon} ${cyan("shell")}  ${dim(this.command)}  ${dur}`, width)
      );
    }

    lines.push(gutterContent(rule, width));

    const bodyLines = stripAnsiForWrap(this.output).split("\n");
    const tail = bodyLines.slice(-this.maxBodyLines);
    for (const raw of tail) {
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

    if (this.reviewQuestion || this.reviewText) {
      lines.push(gutterContent(rule, width));
      if (this.reviewQuestion) {
        lines.push(gutterContent(dim(`@ ${this.reviewQuestion}`), width));
      }
      const reviewLines = this.reviewText.split("\n");
      const rTail = reviewLines.slice(-this.maxReviewLines);
      for (const raw of rTail) {
        const ghost = italic(dim(raw));
        for (const wl of wrapTextWithAnsi(ghost, inner)) {
          lines.push(gutterContent(`${dim("co-partner · ")}${wl}`, width));
        }
      }
    }

    return lines;
  }
}

function stripAnsiForWrap(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
