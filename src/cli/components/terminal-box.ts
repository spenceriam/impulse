import { truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";

/**
 * Live terminal-command surface.
 *
 * Running: one line that auto-expands to a 10-row output box after 2s
 * (or instantly on CTRL+E). Same 3 columns as the turn receipt:
 *   TERMINAL │ output rows (latest pinned at bottom) │ elapsed m:ss
 * Finished: collapses to one permanent row — dark green (exit 0) or
 * dark red (non-zero) with the tail of the output.
 */

const AUTO_EXPAND_MS = 2000;
const BOX_ROWS = 10;
const LINE_BUFFER = 500;
const RESET = "\x1b[0m";
const DIM = (s: string) => `\x1b[2m${s}${RESET}`;
const ACCENT = (s: string) => `\x1b[36m${s}${RESET}`;
const bg = (code: number, s: string) => `\x1b[48;5;${code}m${s}${RESET}`;
const RUNNING_BG = 236;
const SUCCESS_BG = 22;
const FAIL_BG = 88;

export class TerminalBox implements Component {
  private lines: string[] = [];
  private readonly startedAt = Date.now();
  private finished = false;
  private exitCode: number | undefined;
  private expanded = false;

  constructor(private readonly command: string) {}

  appendOutput(chunk: string): void {
    for (const raw of chunk.split("\n")) {
      const line = raw.replace(/\r/g, "");
      if (line === "" && this.lines.length === 0) continue;
      this.lines.push(line);
      if (this.lines.length > LINE_BUFFER) this.lines.splice(0, this.lines.length - LINE_BUFFER);
    }
  }

  finish(exitCode: number): void {
    this.finished = true;
    this.exitCode = exitCode;
    this.expanded = false;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  collapse(): void {
    this.expanded = false;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const elapsed = formatElapsed(Date.now() - this.startedAt);

    if (this.finished) {
      const ok = this.exitCode === 0;
      const tail = lastNonEmpty(this.lines) ?? (ok ? "completed" : `exit ${this.exitCode}`);
      const label = ok ? "✓ TERMINAL" : `✗ TERMINAL exit ${this.exitCode}`;
      return [paint(` ${label}  ${truncateToWidth(tail, Math.max(4, width - visibleWidth(label) - 12))}  ${elapsed} `)];
    }

    if (!this.expanded && Date.now() - this.startedAt < AUTO_EXPAND_MS) {
      const cmd = truncateToWidth(this.command, Math.max(10, width - 22));
      return [`${ACCENT("◌")} ${DIM("TERMINAL")} ${cmd}${" ".repeat(Math.max(1, width - 12 - visibleWidth(cmd) - 6))}${DIM(elapsed)}`];
    }

    const inner = Math.max(10, width - 4);
    const head = `┌ TERMINAL ${"─".repeat(Math.max(0, inner - 20))} ${elapsed} ┐`;
    const rows = this.lines.slice(-BOX_ROWS);
    while (rows.length < BOX_ROWS) rows.unshift("");
    const body = rows.map((line) => padTo(bg(RUNNING_BG, ` ${truncateToWidth(line, inner)}`), width));
    const foot = `└${"─".repeat(width - 2)}┘`;
    return [head, ...body, foot];
  }
}

function lastNonEmpty(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim().length > 0) return lines[i];
  }
  return undefined;
}

function padTo(s: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(s));
  return pad === 0 ? s : `${s}${" ".repeat(pad)}${RESET}`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 99) return "99:59";
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
