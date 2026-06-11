import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import type { SideExchange } from "../../session/store.js";
import { helpSectionRule } from "./help-overlay.js";
import {
  intrinsicFramedBoxWidth,
  overlayBottomBorder,
  overlayDim,
  overlayEmptyLine,
  overlayMuted,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

const TITLE = "Side prompt";
const CHROME_TOP_LINES = 2;
const CHROME_BOTTOM_LINES = 3;
const THINKING_PREVIEW_LINES = 4;

const FOOTER_LIVE = "Esc close · C copy to main chat";
const FOOTER_LIVE_SCROLL = "↑↓ scroll · PgUp/PgDn · Esc close · C copy";
const FOOTER_LIST = "↑↓ select · Enter view · Esc close";
const FOOTER_DETAIL = "Esc close · b back to list · C copy";
const FOOTER_DETAIL_SCROLL = "↑↓ scroll · PgUp/PgDn · Esc close · b back · C copy";

const thinkStyle = (s: string) => `\x1b[2m\x1b[3m${s}\x1b[0m`;

export type SideOverlayMode = "live" | "history-list" | "history-detail";

export interface SideOverlayLiveState {
  userText: string;
  contextSnapshot?: string;
  usedContext: boolean;
  thinkingText: string;
  answerText: string;
  complete: boolean;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function plainWidth(s: string): number {
  return visibleWidth(stripAnsi(s));
}

function wrapIndented(
  text: string,
  innerWidth: number,
  indent = "  "
): string[] {
  const contentWidth = Math.max(8, innerWidth - visibleWidth(indent));
  const wrapped = wrapTextWithAnsi(text.trim(), contentWidth);
  if (wrapped.length === 0) return [`${indent}${text.trim()}`];
  return wrapped.map((line) => `${indent}${line}`);
}

function tailLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  return lines.slice(lines.length - max);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function truncateQuestion(text: string, max = 42): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export class SideOverlay implements Component {
  readonly mode: SideOverlayMode;
  private readonly maxHeight: number;
  private measureTerminalWidth: number | null = null;
  private scrollTop = 0;
  private lastBoxWidth = 0;

  private live: SideOverlayLiveState | null = null;
  private exchanges: SideExchange[] = [];
  private selectedIndex = 0;
  private detailExchange: SideExchange | null = null;

  onCancel?: () => void;
  onCopy?: () => void;
  onScroll?: () => void;
  onOpenDetail?: (exchange: SideExchange) => void;
  onBackToList?: () => void;

  constructor(opts: {
    mode: SideOverlayMode;
    maxHeight: number;
    live?: SideOverlayLiveState;
    exchanges?: SideExchange[];
  }) {
    this.mode = opts.mode;
    this.maxHeight = Math.max(
      CHROME_TOP_LINES + CHROME_BOTTOM_LINES + 1,
      opts.maxHeight
    );
    this.live = opts.live ?? null;
    this.exchanges = opts.exchanges ?? [];
  }

  static liveInitial(
    userText: string,
    opts: { contextSnapshot?: string; usedContext: boolean }
  ): SideOverlayLiveState {
    return {
      userText,
      ...(opts.contextSnapshot !== undefined ? { contextSnapshot: opts.contextSnapshot } : {}),
      usedContext: opts.usedContext,
      thinkingText: "",
      answerText: "",
      complete: false,
    };
  }

  getLiveState(): SideOverlayLiveState | null {
    return this.live;
  }

  getDetailExchange(): SideExchange | null {
    return this.detailExchange;
  }

  appendThinking(text: string): void {
    if (!this.live) return;
    this.live.thinkingText += text;
  }

  appendAnswer(text: string): void {
    if (!this.live) return;
    this.live.answerText += text;
  }

  setComplete(): void {
    if (!this.live) return;
    this.live.complete = true;
  }

  openDetail(exchange: SideExchange): void {
    this.detailExchange = exchange;
  }

  invalidate(): void {}

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const innerWidth = Math.max(20, terminal - 8);
    const body = this.buildInnerLines(innerWidth);
    const widths = body.map((l) => plainWidth(l));
    widths.push(visibleWidth(FOOTER_LIVE));
    return intrinsicFramedBoxWidth(terminal, TITLE, widths);
  }

  private viewportBodyLines(): number {
    return Math.max(1, this.maxHeight - CHROME_TOP_LINES - CHROME_BOTTOM_LINES);
  }

  private buildChromeTop(boxWidth: number): string[] {
    return [overlayTitleLine(TITLE, boxWidth), overlayEmptyLine(boxWidth)];
  }

  private buildChromeBottom(
    boxWidth: number,
    innerWidth: number,
    needsScroll: boolean
  ): string[] {
    let footer = FOOTER_LIVE;
    if (this.mode === "history-list") {
      footer = FOOTER_LIST;
    } else if (this.mode === "history-detail") {
      footer = needsScroll ? FOOTER_DETAIL_SCROLL : FOOTER_DETAIL;
    } else if (needsScroll) {
      footer = FOOTER_LIVE_SCROLL;
    }

    return [
      overlayEmptyLine(boxWidth),
      overlaySideLine(overlayDim(footer), innerWidth, boxWidth),
      overlayBottomBorder(boxWidth),
    ];
  }

  private buildLiveBody(innerWidth: number): string[] {
    const live = this.live!;
    const lines: string[] = [];
    const push = (s: string) => lines.push(s);

    push(overlayMuted("  You"));
    for (const row of wrapIndented(live.userText, innerWidth)) {
      push(row);
    }

    if (live.usedContext && live.contextSnapshot?.trim()) {
      push("");
      push(overlayMuted("  Context"));
      for (const row of wrapIndented(live.contextSnapshot, innerWidth)) {
        push(row);
      }
    }

    push(helpSectionRule(innerWidth));

    if (live.thinkingText.trim()) {
      push(overlayMuted("  Thinking"));
      const wrapped = wrapIndented(live.thinkingText, innerWidth);
      const preview = tailLines(wrapped, THINKING_PREVIEW_LINES);
      for (const row of preview) {
        const indent = row.match(/^(\s*)/)?.[1] ?? "";
        const text = row.slice(indent.length);
        push(`${indent}${thinkStyle(text)}`);
      }
      if (wrapped.length > THINKING_PREVIEW_LINES) {
        push(overlayDim("  …"));
      }
      push("");
    }

    if (live.answerText.trim() || live.complete) {
      for (const row of wrapIndented(live.answerText || " ", innerWidth)) {
        push(row);
      }
    } else if (!live.thinkingText.trim()) {
      push(overlayDim("  …"));
    }

    return lines;
  }

  private buildHistoryListBody(innerWidth: number): string[] {
    const lines: string[] = [];
    lines.push("  Side prompts this session");
    lines.push(helpSectionRule(innerWidth));

    if (this.exchanges.length === 0) {
      lines.push("");
      for (const row of wrapIndented(
        "No side prompts yet — use /side <question> during an active turn.",
        innerWidth
      )) {
        lines.push(row);
      }
      return lines;
    }

    const ordered = [...this.exchanges].reverse();
    for (let i = 0; i < ordered.length; i++) {
      const ex = ordered[i]!;
      const n = ordered.length - i;
      const time = formatTime(ex.createdAt);
      const ctxTag = ex.usedContext ? " · with context" : "";
      const marker = i === this.selectedIndex ? "> " : "  ";
      const label = `${marker}${n}. ${truncateQuestion(ex.userText)}`;
      lines.push(overlayDim(`${label}  ${time}${ctxTag}`));
    }

    return lines;
  }

  private buildHistoryDetailBody(innerWidth: number): string[] {
    const ex = this.detailExchange!;
    const lines: string[] = [];
    const push = (s: string) => lines.push(s);

    push(overlayMuted("  You"));
    for (const row of wrapIndented(ex.userText, innerWidth)) {
      push(row);
    }

    if (ex.usedContext && ex.contextSnapshot?.trim()) {
      push("");
      push(overlayMuted("  Context"));
      for (const row of wrapIndented(ex.contextSnapshot, innerWidth)) {
        push(row);
      }
    }

    push(helpSectionRule(innerWidth));

    if (ex.thinkingText?.trim()) {
      push(overlayMuted("  Thinking"));
      for (const row of wrapIndented(ex.thinkingText, innerWidth)) {
        const indent = row.match(/^(\s*)/)?.[1] ?? "";
        const text = row.slice(indent.length);
        push(`${indent}${thinkStyle(text)}`);
      }
      push("");
    }

    for (const row of wrapIndented(ex.assistantText || "(no answer)", innerWidth)) {
      push(row);
    }

    return lines;
  }

  private buildInnerLines(innerWidth: number): string[] {
    if (this.mode === "live" && this.live) {
      return this.buildLiveBody(innerWidth);
    }
    if (this.mode === "history-detail" && this.detailExchange) {
      return this.buildHistoryDetailBody(innerWidth);
    }
    return this.buildHistoryListBody(innerWidth);
  }

  private buildScrollBodyLines(boxWidth: number): string[] {
    const innerWidth = Math.max(20, boxWidth - 4);
    return this.buildInnerLines(innerWidth).map((line) =>
      overlaySideLine(line, innerWidth, boxWidth)
    );
  }

  private maxScrollTop(bodyLength: number): number {
    return Math.max(0, bodyLength - this.viewportBodyLines());
  }

  private pageStep(): number {
    return Math.max(1, this.viewportBodyLines() - 1);
  }

  handleInput(data: string): void {
    if (data === "\x1b") {
      this.onCancel?.();
      return;
    }

    if ((data === "c" || data === "C") && this.onCopy) {
      const canCopy =
        (this.mode === "live" && this.live?.complete && this.live.answerText.trim()) ||
        (this.mode === "history-detail" && this.detailExchange?.assistantText.trim());
      if (canCopy) {
        this.onCopy();
        return;
      }
    }

    if (this.mode === "history-list") {
      const ordered = [...this.exchanges].reverse();
      if (ordered.length === 0) return;

      if (data === "\r") {
        const ex = ordered[this.selectedIndex];
        if (ex) this.onOpenDetail?.(ex);
        return;
      }

      if (data === "\x1b[A" || data === "k") {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.onScroll?.();
        return;
      }
      if (data === "\x1b[B" || data === "j") {
        this.selectedIndex = Math.min(ordered.length - 1, this.selectedIndex + 1);
        this.onScroll?.();
        return;
      }
      return;
    }

    if (this.mode === "history-detail") {
      if (data === "b" || data === "B") {
        this.onBackToList?.();
        return;
      }
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
