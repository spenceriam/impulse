import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import { renderHelpCommandsTable } from "../markdown-table.js";
import {
  buildSlashCommandDefs,
  type BuildSlashCommandsOptions,
} from "../slash-commands.js";
import {
  intrinsicFramedBoxWidth,
  overlayBottomBorder,
  overlayDim,
  overlayEmptyLine,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

const DIM = "\x1b[2m\x1b[38;5;90m";
const RESET = "\x1b[0m";

const FOOTER_IDLE = "Esc close";
const FOOTER_SCROLL = "↑↓ scroll · PgUp/PgDn · Home/End · Esc close";

/** Title + top spacer. */
const CHROME_TOP_LINES = 2;
/** Spacer + footer + bottom border. */
const CHROME_BOTTOM_LINES = 3;

export type BuildHelpOverlayOptions = BuildSlashCommandsOptions;

export interface HelpOverlayOptions {
  opts: BuildHelpOverlayOptions;
  maxHeight: number;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function plainWidth(s: string): number {
  return visibleWidth(stripAnsi(s));
}

/** Section divider sized to overlay inner width (not full terminal). */
export function helpSectionRule(innerWidth: number): string {
  return `${DIM}  ${"─".repeat(Math.max(8, innerWidth - 2))}${RESET}`;
}

/** Wrap prose with consistent `  ` indent on every line. */
export function wrapIndentedProse(text: string, innerWidth: number, indent = "  "): string[] {
  const contentWidth = Math.max(8, innerWidth - visibleWidth(indent));
  const wrapped = wrapTextWithAnsi(text.trim(), contentWidth);
  if (wrapped.length === 0) return [`${indent}${text.trim()}`];
  return wrapped.map((line) => `${indent}${line}`);
}

/** Build help inner lines at the overlay host inner width (single layout pass). */
export function buildHelpContent(
  opts: BuildHelpOverlayOptions,
  innerWidth: number
): string[] {
  const { reasoningLevelsLabel, experimentalAdvisor = false } = opts;
  const defs = buildSlashCommandDefs({
    experimentalAdvisor,
    reasoningLevelsLabel,
  });

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);
  const pushBlank = () => lines.push("");
  const pushSection = (title: string) => {
    pushBlank();
    push(`  ${title}`);
    push(helpSectionRule(innerWidth));
  };

  pushSection("About");
  for (const row of wrapIndentedProse(
    "impulse is a provider-flexible terminal AI coding agent for software development.",
    innerWidth
  )) {
    push(row);
  }
  for (const row of wrapIndentedProse(
    "Use modes to control what the agent may do; slash commands configure models, sessions, and tools.",
    innerWidth
  )) {
    push(row);
  }
  pushBlank();

  pushSection("Commands");
  const tableInner = Math.max(20, innerWidth - 2);
  for (const row of renderHelpCommandsTable(defs, tableInner)) {
    push(`  ${row}`);
  }
  pushBlank();

  pushSection("Modes (/mode)");
  for (const modeLine of [
    "AGENT (default) — full tool access",
    "EXPLORE — read-only examination",
    "PLAN — plan next steps without executing",
    "DEBUG — structured debugging workflow",
  ]) {
    for (const row of wrapIndentedProse(modeLine, innerWidth)) {
      push(row);
    }
  }
  pushBlank();

  pushSection("Images and vision");
  for (const row of wrapIndentedProse(
    "Paste an image or file path to attach as [Pasted image #N]",
    innerWidth
  )) {
    push(row);
  }
  for (const row of wrapIndentedProse(
    "/vision — Toggle vision and choose a vision model (same or different provider)",
    innerWidth
  )) {
    push(row);
  }
  pushBlank();

  pushSection("Status line");
  for (const statusLine of [
    "Processing... — model, thinking, or vision work",
    "Working... — tool runs",
    "All Permissions Bypassed — shown when /allow-all is on",
  ]) {
    for (const row of wrapIndentedProse(statusLine, innerWidth)) {
      push(row);
    }
  }
  pushBlank();

  pushSection("Keyboard");
  for (const keyLine of [
    "Tab — Cycle mode, or complete /command when line starts with /",
    `Shift+Tab — Cycle reasoning (${reasoningLevelsLabel}); ignored while typing /commands`,
    "↑ — Recall previous submitted prompt",
    "Esc — Close overlays (e.g. /help) or abort current turn",
    "Ctrl+C — Hit again to cancel turn (while busy) or exit (idle)",
    "Ctrl+C Ctrl+C — Exit with session summary when idle",
    "Ctrl+D — Exit",
  ]) {
    for (const row of wrapIndentedProse(keyLine, innerWidth)) {
      push(row);
    }
  }
  pushBlank();

  return lines;
}

export class HelpOverlay implements Component {
  private opts: BuildHelpOverlayOptions;
  private maxHeight: number;
  private measureTerminalWidth: number | null = null;
  private scrollTop = 0;
  private lastBoxWidth = 0;

  onCancel?: () => void;
  onScroll?: () => void;

  constructor(options: HelpOverlayOptions) {
    this.opts = options.opts;
    this.maxHeight = Math.max(CHROME_TOP_LINES + CHROME_BOTTOM_LINES + 1, options.maxHeight);
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const innerWidth = Math.max(20, overlayBoxWidth(terminal) - 4);
    const content = buildHelpContent(this.opts, innerWidth);
    const widths = content.map((l) => plainWidth(l));
    widths.push(visibleWidth(FOOTER_IDLE));
    widths.push(visibleWidth(FOOTER_SCROLL));
    return intrinsicFramedBoxWidth(terminal, "Help", widths);
  }

  private viewportBodyLines(): number {
    return Math.max(1, this.maxHeight - CHROME_TOP_LINES - CHROME_BOTTOM_LINES);
  }

  private buildScrollBodyLines(boxWidth: number): string[] {
    const innerWidth = Math.max(20, boxWidth - 4);
    const content = buildHelpContent(this.opts, innerWidth);
    return content.map((line) => overlaySideLine(line, innerWidth, boxWidth));
  }

  private buildChromeTop(boxWidth: number): string[] {
    return [overlayTitleLine("Help", boxWidth), overlayEmptyLine(boxWidth)];
  }

  private buildChromeBottom(
    boxWidth: number,
    innerWidth: number,
    needsScroll: boolean
  ): string[] {
    return [
      overlayEmptyLine(boxWidth),
      overlaySideLine(
        overlayDim(needsScroll ? FOOTER_SCROLL : FOOTER_IDLE),
        innerWidth,
        boxWidth
      ),
      overlayBottomBorder(boxWidth),
    ];
  }

  private maxScrollTop(bodyLength: number): number {
    return Math.max(0, bodyLength - this.viewportBodyLines());
  }

  private pageStep(): number {
    return Math.max(1, this.viewportBodyLines() - 1);
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b") {
      this.onCancel?.();
      return;
    }

    const body = this.buildScrollBodyLines(this.lastBoxWidth || 80);
    const maxTop = this.maxScrollTop(body.length);
    if (maxTop === 0) return;

    let next = this.scrollTop;
    if (data === "\x1b[A" || data === "k") {
      next = Math.max(0, this.scrollTop - 1);
    } else if (data === "\x1b[B" || data === "j") {
      next = Math.min(maxTop, this.scrollTop + 1);
    } else if (data === "\x1b[5~" || data === "\x1b[b") {
      next = Math.max(0, this.scrollTop - this.pageStep());
    } else if (data === "\x1b[6~" || data === "\x1b[f") {
      next = Math.min(maxTop, this.scrollTop + this.pageStep());
    } else if (
      data === "\x1b[H" ||
      data === "\x1bOH" ||
      data === "\x1b[1;1H" ||
      data === "g"
    ) {
      next = 0;
    } else if (
      data === "\x1b[F" ||
      data === "\x1bOF" ||
      data === "\x1b[1;1F" ||
      data === "G"
    ) {
      next = maxTop;
    } else {
      return;
    }

    if (next !== this.scrollTop) {
      this.scrollTop = next;
      this.onScroll?.();
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    this.lastBoxWidth = boxWidth;

    const chromeTop = this.buildChromeTop(boxWidth);
    const scrollBody = this.buildScrollBodyLines(boxWidth);
    const needsScroll = scrollBody.length > this.viewportBodyLines();
    const chromeBottom = this.buildChromeBottom(boxWidth, innerWidth, needsScroll);

    if (!needsScroll) {
      this.scrollTop = 0;
      return [...chromeTop, ...scrollBody, ...chromeBottom];
    }

    const maxTop = this.maxScrollTop(scrollBody.length);
    this.scrollTop = Math.min(this.scrollTop, maxTop);
    const visibleBody = scrollBody.slice(
      this.scrollTop,
      this.scrollTop + this.viewportBodyLines()
    );

    return [...chromeTop, ...visibleBody, ...chromeBottom];
  }
}
