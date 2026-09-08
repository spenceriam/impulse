import { truncateToWidth, type Component } from "@mariozechner/pi-tui";

/**
 * Single live receipt row for an agent turn:
 *   <spinner> <status ~14ch> │ <activity scrollback> │ <elapsed m:ss>
 *
 * One line represents ALL thinking, tool calls, and actions for the turn.
 * The spinner is Circle Pulse (◌◍, 300ms). The row is removed when the
 * turn ends — permanent history lives in the CTRL+T transcript.
 */

const SPINNER_FRAMES = ["◌", "◍"] as const;
const SPINNER_INTERVAL_MS = 300;
const STATUS_WIDTH = 14;
const ELAPSED_WIDTH = 5; // "12:34"

const RESET = "\x1b[0m";
const DIM = (s: string) => `\x1b[2m${s}${RESET}`;
const ACCENT = (s: string) => `\x1b[36m${s}${RESET}`;

export class TurnReceipt implements Component {
  private status = "Starting";
  private activity = "";
  private readonly startedAt = Date.now();
  private finished = false;

  /** Latest visible activity wins; the column never grows past one line. */
  update(status: string, activity: string): void {
    this.status = status;
    this.activity = activity;
  }

  markFinished(): void {
    this.finished = true;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const elapsedMs = Date.now() - this.startedAt;
    const frame = this.finished
      ? SPINNER_FRAMES[0]!
      : SPINNER_FRAMES[Math.floor(elapsedMs / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length]!;

    const elapsed = formatElapsed(elapsedMs);
    const sep = DIM("│");
    const avail = Math.max(10, width - STATUS_WIDTH - ELAPSED_WIDTH - 6);
    const activity = truncateToWidth(this.activity || DIM("…"), avail);

    return [
      `${ACCENT(frame)} ${truncateToWidth(this.status, STATUS_WIDTH).padEnd(STATUS_WIDTH)} ${sep} ${activity} ${sep} ${DIM(elapsed)}`,
    ];
  }
}

/** 3–5 word status for the receipt's first column, by tool name. */
export function receiptStatusFor(toolName: string): string {
  if (["file_read", "glob", "grep", "ls", "tool_docs", "doctor"].includes(toolName)) return "Reading files";
  if (["file_write", "file_edit"].includes(toolName)) return "Editing files";
  if (toolName === "bash") return "Running command";
  if (toolName === "task") return "Delegating work";
  if (toolName.startsWith("todo_")) return "Updating todos";
  if (toolName === "question") return "Waiting for you";
  if (toolName.startsWith("web_") || toolName === "github_issue") return "Researching";
  if (toolName === "execution_handoff") return "Awaiting authority";
  if (toolName.startsWith("bg_")) return "Managing jobs";
  if (toolName.startsWith("skill_") || toolName === "install_skill") return "Managing skills";
  return "Working";
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 99) return "99:59";
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
