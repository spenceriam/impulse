import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";

const A = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

const clr = {
  border: (s: string) => A.fg(90, s),
  header: (s: string) => `\x1b[1m${s}${A.reset}`,
  dim: (s: string) => A.fg(90, s),
};

interface MarkdownTable {
  header: string[];
  rows: string[][];
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutOuter = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutOuter.split("|").map((cell) => cell.trim());
}

function isTableCandidate(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && splitTableRow(trimmed).length >= 2;
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function isSeparatorRow(line: string): boolean {
  if (!isTableCandidate(line)) return false;
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every(isSeparatorCell);
}

function normalizeRow(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...Array.from({ length: width - row.length }, () => "")];
}

function parseTable(lines: string[], startIndex: number): { table: MarkdownTable; nextIndex: number } | null {
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];
  if (headerLine === undefined || separatorLine === undefined) return null;
  if (!isTableCandidate(headerLine) || !isSeparatorRow(separatorLine)) return null;

  const header = splitTableRow(headerLine);
  const columnCount = header.length;
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || !isTableCandidate(line) || isSeparatorRow(line)) break;
    const row = splitTableRow(line);
    if (row.length < 2) break;
    rows.push(normalizeRow(row, columnCount));
    index += 1;
  }

  if (rows.length === 0) return null;
  return { table: { header, rows }, nextIndex: index };
}

function padCell(cell: string, width: number): string {
  const truncated = truncateToWidth(cell, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return `${truncated}${" ".repeat(padding)}`;
}

function tableTotalWidth(widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1;
}

function tableColumnWidths(table: MarkdownTable): number[] {
  return table.header.map((header, column) => {
    const rowMax = table.rows.reduce((max, row) => Math.max(max, visibleWidth(row[column] ?? "")), 0);
    return Math.max(3, Math.min(60, Math.max(visibleWidth(header), rowMax)));
  });
}

function renderBorder(left: string, middle: string, right: string, widths: number[]): string {
  return clr.border(`${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`);
}

function renderWideTable(table: MarkdownTable, widths: number[]): string[] {
  const renderRow = (row: string[], header: boolean): string => {
    const cells = widths.map((width, index) => {
      const value = padCell(row[index] ?? "", width);
      return ` ${header ? clr.header(value) : value} `;
    });
    return `${clr.border("│")}${cells.join(clr.border("│"))}${clr.border("│")}`;
  };

  return [
    renderBorder("┌", "┬", "┐", widths),
    renderRow(table.header, true),
    renderBorder("├", "┼", "┤", widths),
    ...table.rows.map((row) => renderRow(row, false)),
    renderBorder("└", "┴", "┘", widths),
  ];
}

function renderStackedTable(table: MarkdownTable, width: number): string[] {
  const lines: string[] = [];
  const labelWidth = Math.min(25, Math.max(...table.header.map((header) => visibleWidth(header)), 3));
  const useTwoLineFields = width < labelWidth + 18;

  table.rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) lines.push("");
    lines.push(clr.dim(`[${rowIndex + 1}]`));

    for (let column = 0; column < table.header.length; column += 1) {
      const value = row[column] ?? "";

      if (useTwoLineFields) {
        const label = truncateToWidth(table.header[column] ?? "", Math.max(8, width - 2));
        lines.push(`  ${clr.dim(label)}`);
        const wrapped = wrapTextWithAnsi(value.length > 0 ? value : " ", Math.max(8, width - 4));
        for (const wrappedLine of wrapped) {
          lines.push(`    ${wrappedLine}`);
        }
        continue;
      }

      const label = padCell(table.header[column] ?? "", labelWidth);
      const prefix = `  ${clr.dim(label)}  `;
      const wrapped = wrapTextWithAnsi(value.length > 0 ? value : " ", Math.max(8, width - visibleWidth(label) - 4));
      for (let lineIndex = 0; lineIndex < wrapped.length; lineIndex += 1) {
        const continuationPrefix = `  ${" ".repeat(labelWidth)}  `;
        lines.push(`${lineIndex === 0 ? prefix : continuationPrefix}${wrapped[lineIndex] ?? ""}`);
      }
    }
  });

  return lines;
}

function renderTable(table: MarkdownTable, width: number): string[] {
  const widths = tableColumnWidths(table);
  if (tableTotalWidth(widths) <= width) {
    return renderWideTable(table, widths);
  }
  return renderStackedTable(table, width);
}

function formatMarkdownLine(line: string): string {
  let result = line;
  // ### Header -> bold
  result = result.replace(/^#{1,4}\s+(.+)$/, (_, text) => A.bold + text + A.reset);
  // **bold** -> ANSI bold
  result = result.replace(/\*\*(.+?)\*\*/g, (_, text) => A.bold + text + A.reset);
  // *italic* -> ANSI italic (but not ** which is already handled)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, text) => A.italic + text + A.reset);
  // `code` -> dim
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
