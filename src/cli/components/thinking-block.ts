import { wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { formatDurationMs } from "../format-helpers.js";
import { GUTTER, innerWidth, truncateGutterLine } from "../gutter.js";
import { formatThinkingBodyPart } from "../thinking-style.js";

const THINKING_BLOCK_TAG = Symbol("thinkingBlock");

const MAX_THINKING_DISPLAY_CHARS = 8000;
const MAX_THINKING_DISPLAY_LINES = 40;

const THINKING_COLOR = "\x1b[38;5;94m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m\x1b[38;5;90m";

export function formatThoughtSummary(durationMs?: number): string {
  if (durationMs !== undefined && durationMs > 0) {
    return `Thought for ${formatDurationMs(durationMs)}`;
  }
  return "Thought";
}

export class ThinkingBlock implements Component {
  readonly [THINKING_BLOCK_TAG] = true;

  private phase: "streaming" | "finalized" = "streaming";
  private streamingMode: "body" | "placeholder" = "body";
  private expanded = false;
  private raw = "";
  private truncateDisplay = false;
  private hiddenCharCount = 0;
  private durationMs: number | undefined;

  /** Hide streamed body in the UI but keep accumulating content for finalize /show-think. */
  setPlaceholder(): void {
    this.phase = "streaming";
    this.streamingMode = "placeholder";
  }

  /** Append reasoning tokens without clearing prior content (placeholder or body). */
  appendContent(chunk: string): void {
    if (!chunk) return;
    this.phase = "streaming";
    const combined = this.raw + chunk;
    this.applyRawText(combined);
  }

  setTruncateDisplay(enabled: boolean): void {
    this.truncateDisplay = enabled;
  }

  setText(text: string): void {
    this.phase = "streaming";
    this.streamingMode = "body";
    this.applyRawText(text);
  }

  private applyRawText(text: string): void {
    if (this.truncateDisplay && text.length > MAX_THINKING_DISPLAY_CHARS) {
      this.hiddenCharCount = text.length - MAX_THINKING_DISPLAY_CHARS;
      this.raw = text.slice(0, MAX_THINKING_DISPLAY_CHARS);
    } else {
      this.hiddenCharCount = 0;
      this.raw = text;
    }
  }

  finalize(durationMs: number): void {
    this.phase = "finalized";
    this.durationMs = durationMs > 0 ? durationMs : undefined;
    this.expanded = false;
  }

  setExpanded(expanded: boolean): void {
    if (this.phase !== "finalized") return;
    this.expanded = expanded;
  }

  isFinalized(): boolean {
    return this.phase === "finalized";
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.phase === "finalized" && !this.expanded) {
      const marker = "▶";
      const summary = formatThoughtSummary(this.durationMs);
      const line = `${GUTTER}${THINKING_COLOR}${marker} ${summary}${RESET}`;
      return [truncateGutterLine(line, width)];
    }

    if (this.phase === "streaming" && this.streamingMode === "placeholder") {
      const line = `${GUTTER}${THINKING_COLOR}Thinking...${RESET}`;
      return [truncateGutterLine(line, width)];
    }

    const prefix = GUTTER;
    const label = this.phase === "finalized" ? "▼ Thinking:" : "Thinking:";
    const firstPrefix = `${prefix}${THINKING_COLOR}${label}${RESET} `;
    const continuationPrefix = " ".repeat(prefix.length + label.length + 1);
    const textWidth = Math.max(8, innerWidth(width) - label.length - 1);
    const lines: string[] = [];
    let isFirstOutputLine = true;

    for (const paragraph of this.raw.replace(/\r\n/g, "\n").split("\n")) {
      if (paragraph.length === 0) {
        lines.push(continuationPrefix);
        isFirstOutputLine = false;
        continue;
      }

      const available = isFirstOutputLine ? textWidth : textWidth;
      const wrapped = wrapTextWithAnsi(paragraph, available);

      for (const part of wrapped) {
        const linePrefix = isFirstOutputLine ? firstPrefix : continuationPrefix;
        lines.push(
          truncateGutterLine(`${linePrefix}${formatThinkingBodyPart(part)}`, width)
        );
        isFirstOutputLine = false;
      }
    }

    if (this.truncateDisplay && lines.length > MAX_THINKING_DISPLAY_LINES) {
      const omitted = lines.length - MAX_THINKING_DISPLAY_LINES;
      lines.length = MAX_THINKING_DISPLAY_LINES;
      const foot = `${continuationPrefix}${DIM}… ${omitted} more lines hidden (/settings)${RESET}`;
      lines.push(truncateGutterLine(foot, width));
    } else if (this.hiddenCharCount > 0) {
      const foot = `${continuationPrefix}${DIM}… ${this.hiddenCharCount} more characters hidden (/settings)${RESET}`;
      lines.push(truncateGutterLine(foot, width));
    }

    if (lines.length > 0) {
      return lines;
    }

    if (this.phase === "finalized" && this.expanded) {
      const empty = `${continuationPrefix}${DIM}(reasoning was hidden in /settings — no text stored)${RESET}`;
      return [truncateGutterLine(firstPrefix, width), truncateGutterLine(empty, width)];
    }

    return [truncateGutterLine(firstPrefix, width)];
  }
}

export function isThinkingBlock(component: Component): component is ThinkingBlock {
  return (component as ThinkingBlock)[THINKING_BLOCK_TAG] === true;
}