/**
 * ContextBar — footer component shown at the bottom of every turn.
 *
 * Layout (wide):
 *   model | 68k/200k 34% | dir ⎇ branch | mode | ⚡ tk/s ◷ secs
 *
 * Narrow viewport: stats move to row 2, then mode, then dir/branch are dropped
 * from row 1 to keep the model name visible without truncation.
 */

import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { GUTTER, GUTTER_WIDTH } from "../gutter.js";
import {
  COMPACT_WARNING_THRESHOLD,
  COMPACT_TRIGGER_THRESHOLD,
} from "../../session/compact.js";
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
  warn:    (s: string) => c.fg(33, s),   // orange/yellow — compaction approaching (50–59%)
  crit:    (s: string) => c.fg(31, s),   // red — at/over auto-compact (60%+)
  dir:     (s: string) => c.fg(37, s),   // white
  branch:  (s: string) => c.fg(35, s),   // magenta
  mode:    (s: string) => c.fg(34, s),   // blue
  advisor: (s: string) => c.fg(35, s),   // magenta
  dim:     (s: string) => c.fg(90, s),   // dark gray (stats)
};

/** Visible width of an ANSI-encoded string (strips escape sequences) */
function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
}

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

function formatPercent(pct: number): string {
  const percent = Math.max(0, pct * 100);
  if (percent === 0) return "0%";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function formatPercentColored(pct: number, pctStr: string): string {
  if (pct >= COMPACT_TRIGGER_THRESHOLD) return clr.crit(pctStr);
  if (pct >= COMPACT_WARNING_THRESHOLD) return clr.warn(pctStr);
  return clr.ctx(pctStr);
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

// Per-mode ANSI colors (must match renderer.ts MODE_COLORS)
const MODE_COLOR: Record<string, number> = { AGENT: 34, EXPLORE: 32, PLAN: 33, DEBUG: 31 };

export interface ContextBarState {
  workerModel: string;
  advisorModel?: string | undefined;
  visionModel?: string | undefined;
  visionMode?: boolean;
  contextTokens: number;
  contextWindow: number;
  mode: string;
  reasoningLevel?: string;   // display label: "off", "thinking", "low", "medium", "high"
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

    const pct = s.contextWindow > 0 ? Math.max(0, Math.min(1, s.contextTokens / s.contextWindow)) : 0;
    const pctStr = formatPercent(pct);
    const tokStr = `${formatTokens(s.contextTokens)}/${formatTokens(s.contextWindow)}`;

    // --- Build segments ---

    const sep = clr.sep(" │ ");
    const sepWidth = visibleWidth(sep);

    // Model + reasoning + advisor (never truncated)
    const worker = shortModel(s.workerModel);
    const modelSeg = clr.model(worker);
    const rlSeg = s.reasoningLevel && s.reasoningLevel !== "off"
      ? ` (${clr.model(s.reasoningLevel)})` : "";
    const advisorSeg = s.advisorModel
      ? ` ${sep}${clr.advisor(shortModel(s.advisorModel))} ${clr.advisor("(adv)")}` : "";
    const modelFull = modelSeg + rlSeg + advisorSeg +
      (s.visionMode && s.visionModel ? ` ${sep}${clr.advisor(shortModel(s.visionModel))} ${clr.advisor("(eye)")}` : "");
    const modelWidth = visibleWidth(modelFull);

    // Context: "68k/200k 34%"
    const ctxSeg = `${clr.ctx(tokStr)} ${formatPercentColored(pct, pctStr)}`;
    const ctxWidth = visibleWidth(ctxSeg);

    // Dir + branch (optional — may be dropped)
    const dirSeg = clr.dir(shortDir(cwd));
    const branchSeg = this.cachedBranch ? ` ${clr.branch("⎇")} ${clr.branch(this.cachedBranch)}` : "";
    const dirBranchFull = dirSeg + branchSeg;
    const dirBranchWidth = visibleWidth(dirBranchFull);

    // Mode (optional — hidden for AGENT)
    const modeFull = (s.mode === "AGENT" ? "" : c.fg(MODE_COLOR[s.mode] ?? 34, s.mode))
      + (s.autoCompactOff ? clr.sep(" compact:OFF") : "");
    const modeWidth = visibleWidth(modeFull);

    // Stats (always last — moved to row 2 in narrow viewports)
    let statsFull = "";
    if (s.tokensPerSecond !== undefined && s.tokensPerSecond > 0) {
      statsFull += clr.dim(`\u26a1 ${s.tokensPerSecond} tk/s`); // ⚡
    }
    if (s.lastTurnMs !== undefined && s.lastTurnMs > 0) {
      const secs = (s.lastTurnMs / 1000).toFixed(1);
      statsFull += ` ${clr.dim(`\u29d7 ${secs}s`)}`; // ◷
    }
    const statsWidth = visibleWidth(statsFull);
    const hasStats = statsWidth > 0;

    // Available width (accounting for left gutter)
    const avail = width - GUTTER_WIDTH;

    // --- Layout strategy ---

    // Always build a single row if possible. Model name is never truncated.
    // Strategy: progressively drop segments from primary row, moving stats
    // to row 2, then mode, then dir/branch.

    // Estimate space needed per segment (including separators between them)
    const segmentWidths = [modelWidth, ctxWidth, dirBranchWidth, modeWidth];
    const segmentCount = [modelFull, ctxSeg, dirBranchFull, modeFull].filter(s => visibleWidth(s.trim()) > 0).length;
    const totalSepWidth = segmentCount > 0 ? (segmentCount - 1) * sepWidth : 0;
    const primarySegWidth = segmentWidths.reduce((a, b) => a + b, 0);
    const totalPrimaryWidth = primarySegWidth + totalSepWidth;

    // Option A: Everything on one row (with stats after mode)
    const oneRowWidth = totalPrimaryWidth + (statsWidth > 0 ? sepWidth + statsWidth : 0);

    if (oneRowWidth <= avail) {
      // Everything fits — one row
      const modeStats = modeWidth > 0
        ? modeFull + (hasStats ? sep + statsFull : "")
        : (hasStats ? statsFull : "");
      const parts = [modelFull, ctxSeg, dirBranchFull, modeStats].filter(s => visibleWidth(s.trim()) > 0);
      return [truncateToWidth(GUTTER + parts.join(sep), width), "", ""];
    }

    // Narrow viewport layout

    // Option B: Stats on row 2
    if (hasStats && totalPrimaryWidth + (modeWidth > 0 ? 0 : 0) <= avail) {
      // Remove stats from mode, put on row 2
      const row1Parts = [modelFull, ctxSeg, dirBranchFull, modeFull].filter(s => visibleWidth(s.trim()) > 0);
      return [
        truncateToWidth(GUTTER + row1Parts.join(sep), width),
        truncateToWidth(GUTTER + statsFull, width),
        "",
      ];
    }

    // Option C: Remove dir/branch from row 1, put stats on row 2
    const withoutDir = modelWidth + ctxWidth + (modeWidth > 0 ? sepWidth + modeWidth : 0);
    if (withoutDir <= avail) {
      const row1Parts = [modelFull, ctxSeg, modeFull].filter(s => visibleWidth(s.trim()) > 0);
      const row2Parts = [dirBranchFull, statsFull].filter(s => visibleWidth(s.trim()) > 0);
      return [
        truncateToWidth(GUTTER + row1Parts.join(sep), width),
        truncateToWidth(GUTTER + row2Parts.join(sep), width),
        "",
      ];
    }

    // Option D: Remove mode from row 1 too
    const withoutMode = modelWidth + ctxWidth;
    if (withoutMode <= avail) {
      const row1Parts = [modelFull, ctxSeg].filter(s => visibleWidth(s.trim()) > 0);
      const row2Parts = [modeFull, dirBranchFull, statsFull].filter(s => visibleWidth(s.trim()) > 0);
      return [
        truncateToWidth(GUTTER + row1Parts.join(sep), width),
        truncateToWidth(GUTTER + row2Parts.join(sep), width),
        "",
      ];
    }

    // Option E: Model alone on row 1 (never truncate), everything else on row 2
    const row2Parts = [ctxSeg, dirBranchFull, modeFull, statsFull].filter(s => visibleWidth(s.trim()) > 0);
    const row2Joined = row2Parts.join(sep);
    if (visibleWidth(row2Joined) <= avail) {
      return [
        truncateToWidth(GUTTER + modelFull, width),
        truncateToWidth(GUTTER + row2Joined, width),
        "",
      ];
    }

    // Option F: ultra-narrow — one segment per row (model never truncated)
    const stacked = [modelFull, ctxSeg, dirBranchFull, modeFull, statsFull].filter(s => visibleWidth(s.trim()) > 0);
    return [
      truncateToWidth(GUTTER + stacked[0]!, width),
      truncateToWidth(GUTTER + stacked.slice(1).join(sep), width),
      "",
    ];
  }
}
