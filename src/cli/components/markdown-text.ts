import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";
import { parseTable, renderTable } from "../markdown-table.js";

const A = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

function formatMarkdownLine(line: string): string {
  let result = line;
  result = result.replace(/^#{1,4}\s+(.+)$/, (_, text) => A.bold + text + A.reset);
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
  constructor(indent = "    ") {
    this.indent = indent;
  }

  setText(text: string): void {
    this.raw = text;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const innerWidth = Math.max(8, width - visibleWidth(this.indent));
    const rawLines = this.raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const rendered: string[] = [];

    for (let index = 0; index < rawLines.length;) {
      const table = parseTable(rawLines, index);
      if (table) {
        for (const line of renderTable(table.table, innerWidth)) {
          rendered.push(truncateToWidth(`${this.indent}${line}`, width));
        }
        index = table.nextIndex;
        continue;
      }

      const rawLine = rawLines[index] ?? "";
      if (rawLine.length === 0) {
        rendered.push(this.indent.trimEnd());
        index += 1;
        continue;
      }

      const formatted = formatMarkdownLine(rawLine);
      for (const line of wrapTextWithAnsi(formatted, innerWidth)) {
        rendered.push(truncateToWidth(`${this.indent}${line}`, width));
      }
      index += 1;
    }

    return rendered;
  }
}
