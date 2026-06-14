/**
 * ContextBar — footer component shown at the bottom of every turn.
 *
 * Layout (wide):
 *   model | 68k/200k 34% | dir ⎇ branch | mode | ⚡ tk/s ◷ secs     v1.2.0 | 5/29/26
 *
 * Narrow viewport: left segments wrap/drop; version|date stays lower-right on the last row.
 */

import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { GUTTER, GUTTER_WIDTH } from "../gutter.js";
import {
  formatContextBarRight,
  formatContextBarVersionOnly,
} from "../context-bar-date.js";
import type { BottomBarVisual } from "../../util/config.js";
import {
  COMPACT_WARNING_THRESHOLD,
  COMPACT_TRIGGER_THRESHOLD,
} from "../../session/compact.js";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { formatDurationMs } from "../format-helpers.js";
import { applyOptionalPatch, type OptionalPatch } from "../../util/omit-undefined.js";

export const RIGHT_PAD_COLS = 4;

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
  mode:    (s: string) => c.fg(34, s),   // blue
  advisor: (s: string) => c.fg(35, s),   // magenta
  dim:     (s: string) => c.fg(90, s),   // dark gray (stats)
};

/** Visible width of an ANSI-encoded string (strips escape sequences) */
export function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
}

function shortModel(full: string): string {
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
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length <= 2) return rel;
  const last2 = parts.slice(-2).join(path.sep);
  return cwd.startsWith(home) ? `~/${last2}` : last2;
}

const MODE_COLOR: Record<string, number> = { AGENT: 34, EXPLORE: 32, PLAN: 33, DEBUG: 31 };

function joinParts(parts: string[], sep: string): string {
  return parts.filter((p) => visibleWidth(p.trim()) > 0).join(sep);
}

function truncateLeft(left: string, leftAvail: number): string {
  if (visibleWidth(left) <= leftAvail) return left;
  return truncateToWidth(left, leftAvail);
}

/** Build 1–2 left-only rows within leftAvail (no gutter, no version/date). */
function buildLeftRows(
  leftAvail: number,
  segments: {
    modelFull: string;
    ctxSeg: string;
    dirBranchFull: string;
    modeFull: string;
    statsFull: string;
    sep: string;
    modelWidth: number;
    ctxWidth: number;
    dirBranchWidth: number;
    modeWidth: number;
    statsWidth: number;
    hasStats: boolean;
  }
): string[] {
  const {
    modelFull,
    ctxSeg,
    dirBranchFull,
    modeFull,
    statsFull,
    sep,
    modelWidth,
    ctxWidth,
    dirBranchWidth,
    modeWidth,
    statsWidth,
    hasStats,
  } = segments;
  const sepWidth = visibleWidth(sep);

  const segmentWidths = [modelWidth, ctxWidth, dirBranchWidth, modeWidth];
  const segmentCount = [modelFull, ctxSeg, dirBranchFull, modeFull].filter(
    (p) => visibleWidth(p.trim()) > 0
  ).length;
  const totalSepWidth = segmentCount > 0 ? (segmentCount - 1) * sepWidth : 0;
  const primarySegWidth = segmentWidths.reduce((a, b) => a + b, 0);
  const totalPrimaryWidth = primarySegWidth + totalSepWidth;

  const oneRowWidth = totalPrimaryWidth + (statsWidth > 0 ? sepWidth + statsWidth : 0);

  if (oneRowWidth <= leftAvail) {
    const modeStats =
      modeWidth > 0
        ? modeFull + (hasStats ? sep + statsFull : "")
        : hasStats
          ? statsFull
          : "";
    const parts = [modelFull, ctxSeg, dirBranchFull, modeStats].filter(
      (p) => visibleWidth(p.trim()) > 0
    );
    return [truncateLeft(joinParts(parts, sep), leftAvail)];
  }

  if (hasStats && totalPrimaryWidth <= leftAvail) {
    const row1Parts = [modelFull, ctxSeg, dirBranchFull, modeFull].filter(
      (p) => visibleWidth(p.trim()) > 0
    );
    return [
      truncateLeft(joinParts(row1Parts, sep), leftAvail),
      truncateLeft(statsFull, leftAvail),
    ];
  }

  const withoutDir = modelWidth + ctxWidth + (modeWidth > 0 ? sepWidth + modeWidth : 0);
  if (withoutDir <= leftAvail) {
    const row1Parts = [modelFull, ctxSeg, modeFull].filter((p) => visibleWidth(p.trim()) > 0);
    const row2Parts = [dirBranchFull, statsFull].filter((p) => visibleWidth(p.trim()) > 0);
    return [
      truncateLeft(joinParts(row1Parts, sep), leftAvail),
      truncateLeft(joinParts(row2Parts, sep), leftAvail),
    ];
  }

  const withoutMode = modelWidth + ctxWidth;
  if (withoutMode <= leftAvail) {
    const row1Parts = [modelFull, ctxSeg].filter((p) => visibleWidth(p.trim()) > 0);
    const row2Parts = [modeFull, dirBranchFull, statsFull].filter(
      (p) => visibleWidth(p.trim()) > 0
    );
    return [
      truncateLeft(joinParts(row1Parts, sep), leftAvail),
      truncateLeft(joinParts(row2Parts, sep), leftAvail),
    ];
  }

  const row2Parts = [ctxSeg, dirBranchFull, modeFull, statsFull].filter(
    (p) => visibleWidth(p.trim()) > 0
  );
  const row2Joined = joinParts(row2Parts, sep);
  if (visibleWidth(row2Joined) <= leftAvail) {
    return [truncateLeft(modelFull, leftAvail), truncateLeft(row2Joined, leftAvail)];
  }

  const stacked = [modelFull, ctxSeg, dirBranchFull, modeFull, statsFull].filter(
    (p) => visibleWidth(p.trim()) > 0
  );
  return [
    truncateLeft(stacked[0]!, leftAvail),
    truncateLeft(joinParts(stacked.slice(1), sep), leftAvail),
  ];
}

function applyRightAnchor(
  leftRows: string[],
  width: number,
  leftAvail: number,
  rightSeg: string
): string[] {
  const lastIdx = (() => {
    for (let i = leftRows.length - 1; i >= 0; i--) {
      if (visibleWidth((leftRows[i] ?? "").trim()) > 0) return i;
    }
    return -1;
  })();

  const formatted = leftRows.map((row, i) => {
    if (visibleWidth(row.trim()) === 0) return "";
    let body = row;
    if (i === lastIdx) {
      const pad = Math.max(0, leftAvail - visibleWidth(body));
      body = body + " ".repeat(pad) + rightSeg;
    } else if (visibleWidth(body) > leftAvail) {
      body = truncateToWidth(body, leftAvail);
    }
    return truncateToWidth(GUTTER + body, width);
  });

  if (lastIdx < 0) {
    const pad = Math.max(0, leftAvail);
    const body = " ".repeat(pad) + rightSeg;
    return [truncateToWidth(GUTTER + body, width), "", ""];
  }

  while (formatted.length < 3) formatted.push("");
  return formatted.slice(0, 3);
}

export interface ContextBarState {
  workerModel: string;
  impulseVersion: string;
  advisorModel?: string | undefined;
  visionModel?: string | undefined;
  visionMode?: boolean;
  contextTokens: number;
  contextWindow: number;
  mode: string;
  reasoningLevel?: string;
  autoCompactOff?: boolean;
  isRunning?: boolean;
  cwd?: string;
  tokensPerSecond?: number;
  lastTurnMs?: number;
  allowAllBypass?: boolean;
  showTurnSpeed?: boolean;
  queueDepth?: number;
  goalLabel?: string;
  showAdvisorInBar?: boolean;
  bottomBarVisual?: BottomBarVisual;
}

export class ContextBarComponent implements Component {
  private state: ContextBarState;
  private cachedBranch: string | null = null;
  private branchCwd: string | null = null;

  constructor(state: ContextBarState) {
    this.state = state;
  }

  update(state: OptionalPatch<ContextBarState>): void {
    this.state = applyOptionalPatch(this.state, state);
  }

  invalidate(): void {
    this.cachedBranch = null;
  }

  render(width: number): string[] {
    const s = this.state;
    const visual = s.bottomBarVisual ?? "full";

    if (visual === "off") {
      return [truncateToWidth(GUTTER, width)];
    }

    const cwd = s.cwd ?? process.cwd();
    const showBranch = visual === "full";

    if (showBranch && (this.cachedBranch === null || this.branchCwd !== cwd)) {
      this.cachedBranch = gitBranch(cwd);
      this.branchCwd = cwd;
    }

    const pct =
      s.contextWindow > 0 ? Math.max(0, Math.min(1, s.contextTokens / s.contextWindow)) : 0;
    const pctStr = formatPercent(pct);
    const tokStr = `${formatTokens(s.contextTokens)}/${formatTokens(s.contextWindow)}`;

    const sep = clr.sep(" │ ");

    const worker = shortModel(s.workerModel);
    const modelSeg = clr.model(worker);
    const rlSeg =
      visual === "full" && s.reasoningLevel && s.reasoningLevel !== "off"
        ? ` (${clr.model(s.reasoningLevel)})`
        : "";
    const advisorSeg =
      visual === "full" && s.showAdvisorInBar !== false && s.advisorModel
        ? ` ${sep}${clr.advisor(shortModel(s.advisorModel))}`
        : "";
    const modelFull = modelSeg + rlSeg + advisorSeg;

    const ctxSeg =
      visual === "full"
        ? `${clr.ctx(tokStr)} ${formatPercentColored(pct, pctStr)}`
        : formatPercentColored(pct, pctStr);
    const dirSeg = visual !== "minimal" ? clr.dir(shortDir(cwd)) : "";
    const branchSeg =
      showBranch && this.cachedBranch
        ? ` ${clr.dir("⎇")} ${clr.dir(this.cachedBranch)}`
        : "";
    const dirBranchFull = dirSeg + branchSeg;

    const queueSeg =
      visual === "full" && s.queueDepth && s.queueDepth > 0
        ? clr.sep(` Queue: ${s.queueDepth}`)
        : "";
    const goalSeg =
      visual === "full" && s.goalLabel
        ? clr.sep(` Goal: ${truncateToWidth(s.goalLabel, 24)}`)
        : "";
    const modeFull =
      visual === "full"
        ? (s.mode === "AGENT" ? "" : c.fg(MODE_COLOR[s.mode] ?? 34, s.mode)) +
          queueSeg +
          goalSeg +
          (s.autoCompactOff ? clr.sep(" compact:OFF") : "")
        : "";

    let statsFull = "";
    if (s.allowAllBypass) {
      statsFull = c.fg(214, visual === "full" ? "Allow-All" : "AA");
    } else if (visual === "full" && s.showTurnSpeed) {
      if (s.tokensPerSecond !== undefined && s.tokensPerSecond > 0) {
        statsFull += clr.dim(`\u26a1 ${s.tokensPerSecond} tk/s`);
      }
      if (s.lastTurnMs !== undefined && s.lastTurnMs > 0) {
        statsFull += ` ${clr.dim(`\u29d7 ${formatDurationMs(s.lastTurnMs)}`)}`;
      }
    }

    const now = new Date();
    const rightSeg =
      visual === "minimal"
        ? ""
        : visual === "reduced"
          ? clr.dim(formatContextBarVersionOnly(s.impulseVersion))
          : clr.dim(formatContextBarRight(s.impulseVersion, now));
    const rightWidth = visibleWidth(rightSeg);
    const avail = width - GUTTER_WIDTH;
    const leftAvail = Math.max(0, avail - rightWidth - RIGHT_PAD_COLS);

    const seg = {
      modelFull,
      ctxSeg,
      dirBranchFull,
      modeFull,
      statsFull,
      sep,
      modelWidth: visibleWidth(modelFull),
      ctxWidth: visibleWidth(ctxSeg),
      dirBranchWidth: visibleWidth(dirBranchFull),
      modeWidth: visibleWidth(modeFull),
      statsWidth: visibleWidth(statsFull),
      hasStats: visibleWidth(statsFull) > 0,
    };

    const leftRows = buildLeftRows(leftAvail, seg);
    return applyRightAnchor(leftRows, width, leftAvail, rightSeg);
  }
}
