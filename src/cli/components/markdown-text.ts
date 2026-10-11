import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER, GUTTER_WIDTH, innerWidth, maxLineWidth, truncateGutterLine } from "../gutter.js";
import {
  isCompleteMarkdownTable,
  parseTable,
  renderTable,
  resolveTableLayoutMode,
  type TableLayoutMode,
} from "../markdown-table.js";

const A = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

function formatMarkdownLine(line: string): string {
  let result = line;
  result = result.replace(/^#{1,6}\s+(.+)$/, (_, text) => A.bold + text + A.reset);
  result = result.replace(/\*\*(.+?)\*\*/g, (_, text) => A.bold + text + A.reset);
  result = result.replace(
    /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
    (_, text) => A.italic + text + A.reset
  );
  result = result.replace(/`([^`]+)`/g, (_, text) => A.dim + text + A.reset);
  return result;
}

/** Lines that must stay on their own row: headings, list items, blockquotes. */
const STRUCTURAL_LINE_RE = /^\s*(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>)/;

/** Fence opener/closer (``` or ~~~). */
const FENCE_LINE_RE = /^\s*(```|~~~)/;

export class MarkdownTextBlock implements Component {
  private raw = "";
  private readonly indent: string;
  private tableLayout: TableLayoutMode | null = null;
  constructor(indent = GUTTER) {
    this.indent = indent;
  }

  setText(text: string): void {
    this.raw = text;
    this.tableLayout = null;
  }

  invalidate(): void {
    this.tableLayout = null;
  }

  render(width: number): string[] {
    const indentW = visibleWidth(this.indent);
    const wrapWidth =
      indentW <= GUTTER_WIDTH ? innerWidth(width) : Math.max(8, maxLineWidth(width) - indentW);
    const rawLines = this.raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const rendered: string[] = [];

    const pushFormatted = (text: string): void => {
      for (const line of wrapTextWithAnsi(formatMarkdownLine(text), wrapWidth)) {
        rendered.push(truncateGutterLine(`${this.indent}${line}`, width));
      }
    };

    let inFence = false;
    let index = 0;
    while (index < rawLines.length) {
      const rawLine = rawLines[index] ?? "";

      if (FENCE_LINE_RE.test(rawLine)) {
        inFence = !inFence;
        pushFormatted(rawLine);
        index += 1;
        continue;
      }
      if (inFence) {
        // Code lines never join — a fence's newlines are literal.
        pushFormatted(rawLine);
        index += 1;
        continue;
      }
      if (rawLine.length === 0) {
        rendered.push(truncateGutterLine(this.indent.trimEnd(), width));
        index += 1;
        continue;
      }
      if (isCompleteMarkdownTable(rawLines, index)) {
        const table = parseTable(rawLines, index)!;
        if (this.tableLayout === null) {
          this.tableLayout = resolveTableLayoutMode(table.table, wrapWidth);
        }
        for (const line of renderTable(table.table, wrapWidth, this.tableLayout)) {
          rendered.push(truncateGutterLine(`${this.indent}${line}`, width));
        }
        index = table.nextIndex;
        continue;
      }
      if (STRUCTURAL_LINE_RE.test(rawLine)) {
        pushFormatted(rawLine);
        index += 1;
        continue;
      }

      // Plain paragraph: markdown treats a single newline as a soft break,
      // so join continuation lines with a space before formatting. Without
      // this, inline spans crossing a newline (e.g. `*video games with\n
      // discontinued support*`) never match and render literal asterisks.
      let block = rawLine;
      index += 1;
      while (index < rawLines.length) {
        const next = rawLines[index] ?? "";
        if (
          next.length === 0 ||
          FENCE_LINE_RE.test(next) ||
          STRUCTURAL_LINE_RE.test(next) ||
          isCompleteMarkdownTable(rawLines, index)
        ) {
          break;
        }
        block += ` ${next.trim()}`;
        index += 1;
      }
      pushFormatted(block);
    }

    return rendered;
  }
}
