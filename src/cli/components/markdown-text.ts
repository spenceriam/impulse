import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { GUTTER_WIDTH, innerWidth, maxLineWidth, truncateGutterLine } from "../gutter.js";
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

export class MarkdownTextBlock implements Component {
  private raw = "";
  private readonly indent: string;
  private tableLayout: TableLayoutMode | null = null;
  constructor(indent = "    ") {
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

    for (let index = 0; index < rawLines.length;) {
      if (!isCompleteMarkdownTable(rawLines, index)) {
        // fall through to line handler
      } else {
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

      const rawLine = rawLines[index] ?? "";
      if (rawLine.length === 0) {
        rendered.push(truncateGutterLine(this.indent.trimEnd(), width));
        index += 1;
        continue;
      }

      const formatted = formatMarkdownLine(rawLine);
      for (const line of wrapTextWithAnsi(formatted, wrapWidth)) {
        rendered.push(truncateGutterLine(`${this.indent}${line}`, width));
      }
      index += 1;
    }

    return rendered;
  }
}
