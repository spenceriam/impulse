/**
 * ContextBar — footer component shown at the bottom of every turn.
 *
 * Layout (Option A):
 *   worker-model ◈ advisor | 68k/200k 34% ████████░░░░ | dir ⎇ branch | MODE
 */

import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

// ANSI helpers (no external dep needed)
const c = {
  reset:   "\x1b[0m",
  dim:     "\x1b[2m",
  bold:    "\x1b[1m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}${c.reset}`,
};

const clr = {
  model:   (s: string) => c.fg(36, s),   // cyan
  sep:     (s: string) => c.fg(90, s),   // dark gray
  ctx:     (s: string) => c.fg(33, s),   // yellow
  bar:     (s: string) => c.fg(32, s),   // green
  barWarn: (s: string) => c.fg(33, s),   // yellow (>70%)
  barCrit: (s: string) => c.fg(31, s),   // red (>85%)
  dir:     (s: string) => c.fg(37, s),   // white
  branch:  (s: string) => c.fg(35, s),   // magenta
  mode:    (s: string) => c.fg(34, s),   // blue
  advisor: (s: string) => c.fg(35, s),   // magenta
  dim:     (s: string) => c.fg(90, s),   // dark gray (stats)
};

function shortModel(full: string): string {
  // "openrouter/anthropic/claude-opus-4.7" → "claude-opus-4.7"
  // "ollama/deepseek-r1:70b" → "deepseek-r1:70b"
  const parts = full.split("/");
  return parts[parts.length - 1] ?? full;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function contextBar(pct: number, width = 12): string {
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  if (pct >= 0.85) return clr.barCrit(bar);
  if (pct >= 0.70) return clr.barWarn(bar);
  return clr.bar(bar);
}

function gitBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function shortDir(cwd: string): string {
  const home = os.homedir();
  const rel = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  // Show last 2 path segments but always keep ~/ prefix
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length <= 2) return rel;
  // slice(-2) drops the ~ — prepend it back explicitly
  const last2 = parts.slice(-2).join(path.sep);
  return cwd.startsWith(home) ? `~/${last2}` : last2;
}

export interface ContextBarState {
  workerModel: string;
  advisorModel?: string;
  contextTokens: number;
  contextWindow: number;
  mode: string;
  autoCompactOff?: boolean;
  isRunning?: boolean;
  cwd?: string;
  tokensPerSecond?: number;
  lastTurnMs?: number;
}

export class ContextBarComponent implements Component {
  private state: ContextBarState;
  private cachedBranch: string | null = null;
  private branchCwd: string | null = null;

  constructor(state: ContextBarState) {
    this.state = state;
  }

  update(state: Partial<ContextBarState>): void {
    this.state = { ...this.state, ...state };
  }

  invalidate(): void {
    this.cachedBranch = null;
  }

  render(width: number): string[] {
    const s = this.state;
    const cwd = s.cwd ?? process.cwd();

    // Git branch (cached per cwd)
    if (this.cachedBranch === null || this.branchCwd !== cwd) {
      this.cachedBranch = gitBranch(cwd);
      this.branchCwd = cwd;
    }

    const pct = s.contextWindow > 0 ? s.contextTokens / s.contextWindow : 0;
    const pctStr = `${Math.round(pct * 100)}%`;
    const tokStr = `${formatTokens(s.contextTokens)}/${formatTokens(s.contextWindow)}`;

    // Model segment
    const worker = shortModel(s.workerModel);
    const modelSeg = s.isRunning
      ? clr.model(`${worker}…`)
      : clr.model(worker);
    const advisorSeg = s.advisorModel
      ? ` ${clr.advisor("◈")} ${clr.advisor(shortModel(s.advisorModel))}`
      : "";

    const sep = clr.sep(" │ ");

    // Context segment
    const ctxSeg = `${clr.ctx(tokStr)} ${clr.ctx(pctStr)} ${contextBar(pct)}`;

    // Dir + branch segment
    const dirSeg = clr.dir(shortDir(cwd));
    const branchSeg = this.cachedBranch
      ? ` ${clr.branch("⎇")} ${clr.branch(this.cachedBranch)}`
      : "";

    // Mode segment
    const modeSeg = clr.mode(s.mode);

    // Auto-compact off indicator
    const compactSeg = s.autoCompactOff ? clr.sep(" compact:OFF") : "";

    // Stats: token speed + turn time
    let statsSeg = "";
    if (s.tokensPerSecond !== undefined && s.tokensPerSecond > 0) {
      statsSeg += sep + clr.dim(`${s.tokensPerSecond} tk/s`);
    }
    if (s.lastTurnMs !== undefined && s.lastTurnMs > 0) {
      const secs = (s.lastTurnMs / 1000).toFixed(1);
      statsSeg += ` ${clr.dim(`${secs}s`)}`;
    }

    const line =
      modelSeg + advisorSeg + sep +
      ctxSeg + sep +
      dirSeg + branchSeg + sep +
      modeSeg + compactSeg + statsSeg;

    // Truncate to terminal width
    return [truncateToWidth(line, width)];
  }
}
