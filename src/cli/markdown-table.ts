/**
 * Markdown-style table layout (shared by chat MarkdownTextBlock and /help overlay).
 */

import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import type { SlashCommandDef } from "./slash-commands.js";

const A = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

const clr = {
  border: (s: string) => A.fg(90, s),
  header: (s: string) => `\x1b[1m${s}${A.reset}`,
  dim: (s: string) => A.fg(90, s),
};

export interface MarkdownTable {
  header: string[];
  rows: string[][];
}

export function slashCommandsToTable(defs: SlashCommandDef[]): MarkdownTable {
  return {
    header: ["Command", "Description"],
    rows: defs.map((d) => [d.cmd, d.helpDetail ?? d.hint]),
  };
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

export function parseTable(
  lines: string[],
  startIndex: number
): { table: MarkdownTable; nextIndex: number } | null {
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

export function tableTotalWidth(widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1;
}

export function tableColumnWidths(table: MarkdownTable): number[] {
  return table.header.map((header, column) => {
    const rowMax = table.rows.reduce(
      (max, row) => Math.max(max, visibleWidth(row[column] ?? "")),
      0
    );
    return Math.max(3, Math.min(60, Math.max(visibleWidth(header), rowMax)));
  });
}

function renderBorder(left: string, middle: string, right: string, widths: number[]): string {
  return clr.border(`${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`);
}

export function renderWideTable(table: MarkdownTable, widths: number[]): string[] {
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

export function renderStackedTable(table: MarkdownTable, width: number): string[] {
  const lines: string[] = [];
  const labelWidth = Math.min(
    25,
    Math.max(...table.header.map((header) => visibleWidth(header)), 3)
  );
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
      const wrapped = wrapTextWithAnsi(
        value.length > 0 ? value : " ",
        Math.max(8, width - visibleWidth(stripAnsi(label)) - 4)
      );
      for (let lineIndex = 0; lineIndex < wrapped.length; lineIndex += 1) {
        const continuationPrefix = `  ${" ".repeat(labelWidth)}  `;
        lines.push(`${lineIndex === 0 ? prefix : continuationPrefix}${wrapped[lineIndex] ?? ""}`);
      }
    }
  });

  return lines;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export function renderTable(table: MarkdownTable, width: number): string[] {
  const widths = tableColumnWidths(table);
  if (tableTotalWidth(widths) <= width) {
    return renderWideTable(table, widths);
  }
  return renderStackedTable(table, width);
}

function helpDetail(def: SlashCommandDef): string {
  return def.helpDetail ?? def.hint;
}

function padCellNoTruncate(cell: string, width: number): string {
  const plainLen = visibleWidth(stripAnsi(cell));
  if (plainLen >= width) return cell;
  return `${cell}${" ".repeat(width - plainLen)}`;
}

function renderWideTableRow(
  cells: [string, string],
  widths: [number, number],
  header: boolean
): string {
  const parts = widths.map((width, index) => {
    const raw = cells[index] ?? "";
    const value = padCellNoTruncate(header ? clr.header(raw) : raw, width);
    return ` ${value} `;
  });
  return `${clr.border("│")}${parts.join(clr.border("│"))}${clr.border("│")}`;
}

/**
 * Help /help command table: dynamic column widths, wrap descriptions (no ellipsis).
 */
export function renderHelpCommandsTable(
  defs: SlashCommandDef[],
  innerWidth: number
): string[] {
  if (defs.length === 0) return [];

  const table = slashCommandsToTable(defs);
  const cmdW = Math.max(
    7,
    visibleWidth("Command"),
    ...defs.map((d) => visibleWidth(d.cmd))
  );
  const descW = Math.max(12, innerWidth - cmdW - 3);
  const widths: [number, number] = [cmdW, descW];

  if (tableTotalWidth(widths) > innerWidth) {
    return renderStackedTable(table, innerWidth);
  }

  const lines: string[] = [
    renderBorder("┌", "┬", "┐", widths),
    renderWideTableRow(["Command", "Description"], widths, true),
    renderBorder("├", "┼", "┤", widths),
  ];

  for (const def of defs) {
    const detail = helpDetail(def);
    const descLines = wrapTextWithAnsi(detail.length > 0 ? detail : " ", descW);
    const rows = descLines.length > 0 ? descLines : [""];

    for (let i = 0; i < rows.length; i++) {
      const cmd = i === 0 ? def.cmd : "";
      lines.push(renderWideTableRow([cmd, rows[i] ?? ""], widths, false));
    }
  }

  lines.push(renderBorder("└", "┴", "┘", widths));
  return lines;
}
