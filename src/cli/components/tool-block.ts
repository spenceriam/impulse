/**
 * ToolBlock — renders a tool call (name, args summary, result).
 * Updates in-place: shows spinner while running, result when done.
 */

import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";

const c = {
  reset: "\x1b[0m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

const clr = {
  toolName:   (s: string) => c.fg(36, s),   // cyan
  args:       (s: string) => c.fg(90, s),   // dark gray
  success:    (s: string) => c.fg(32, s),   // green
  error:      (s: string) => c.fg(31, s),   // red
  running:    (s: string) => c.fg(33, s),   // yellow
  dim:        (s: string) => c.fg(90, s),   // dark gray
  duration:   (s: string) => c.fg(90, s),   // dark gray
  permission: (s: string) => c.fg(33, s),   // yellow (warning)
};

const SPINNER = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let spinnerFrame = 0;

export type ToolBlockState =
  | { status: "running";    name: string; argsSummary: string }
  | { status: "done";       name: string; argsSummary: string; success: boolean; outputSummary: string; durationMs: number }
  | { status: "permission"; name: string; argsSummary: string; description: string };

function argsSummary(args: Record<string, unknown>): string {
  // Show the most meaningful arg value
  const keys = ["path", "filePath", "file", "command", "pattern", "query", "description", "prompt"];
  for (const k of keys) {
    if (args[k] && typeof args[k] === "string") {
      const v = String(args[k]);
      return v.length > 50 ? v.slice(0, 47) + "…" : v;
    }
  }
  const entries = Object.entries(args).slice(0, 2);
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ").slice(0, 50);
}

function outputSummary(output: string): string {
  const first = output.trim().split("\n")[0] ?? "";
  return first.length > 60 ? first.slice(0, 57) + "…" : first;
}

export class ToolBlock implements Component {
  private state: ToolBlockState;

  constructor(name: string, args: Record<string, unknown>) {
    this.state = {
      status: "running",
      name,
      argsSummary: argsSummary(args),
    };
  }

  setDone(success: boolean, output: string, durationMs: number): void {
    this.state = {
      status: "done",
      name: this.state.name,
      argsSummary: this.state.argsSummary,
      success,
      outputSummary: outputSummary(output),
      durationMs,
    };
  }

  setPermissionPrompt(description: string): void {
    this.state = {
      status: "permission",
      name: this.state.name,
      argsSummary: this.state.argsSummary,
      description,
    };
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = this.state;
    spinnerFrame = (spinnerFrame + 1) % SPINNER.length;

    if (s.status === "running") {
      const spinner = clr.running(SPINNER[spinnerFrame] ?? "…");
      const line = `  ${spinner} ${clr.toolName(s.name)}  ${clr.args(s.argsSummary)}`;
      return [truncateToWidth(line, width)];
    }

    if (s.status === "permission") {
      const line = `  ${clr.permission("⚠")}  ${clr.toolName(s.name)}  ${clr.args(s.description)}`;
      const hint = `     ${clr.dim("[y]es  [n]o  [a]lways  [s]ession")}`;
      return [truncateToWidth(line, width), hint];
    }

    // done
    const icon = s.success ? clr.success("✓") : clr.error("✗");
    const dur = clr.duration(`${s.durationMs}ms`);
    const summary = s.outputSummary ? clr.args(`  ${s.outputSummary}`) : "";
    const line = `  ${icon}  ${clr.toolName(s.name)}  ${clr.args(s.argsSummary)}  ${dur}`;
    const lines = [truncateToWidth(line, width)];
    if (summary) lines.push(truncateToWidth(`     ${summary}`, width));
    return lines;
  }
}
