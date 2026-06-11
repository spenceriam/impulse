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
  italic: "\x1b[3m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

/** Inline markdown for table cells and help text (bold, italic, code). */
export function formatInlineMarkdown(line: string): string {
  let result = line;
  result = result.replace(/\*\*(.+?)\*\*/g, (_, text) => A.bold + text + A.reset);
  result = result.replace(
    /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
    (_, text) => A.italic + text + A.reset
  );
  result = result.replace(/`([^`]+)`/g, (_, text) => A.dim + text + A.reset);
  return result;
}

function formatTable(table: MarkdownTable): MarkdownTable {
  return {
    header: table.header.map(formatInlineMarkdown),
    rows: table.rows.map((row) => row.map(formatInlineMarkdown)),
  };
}

const clr = {
  border: (s: string) => A.fg(90, s),
  header: (s: string) => `\x1b[1m${s}${A.reset}`,
  dim: (s: string) => A.fg(90, s),
};

/** Gray foreground for table borders and help section rules (no dim). */
export function tableBorderFg(text: string): string {
  return clr.border(text);
}

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

function unescapeTableCell(cell: string): string {
  return cell.replace(/\\\|/g, "|");
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutOuter = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutOuter
    .split(/(?<!\\)\|/)
    .map((cell) => unescapeTableCell(cell.trim()));
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

/** True when a full markdown table (header + separator + ≥1 row) is present at startIndex. */
export function isCompleteMarkdownTable(lines: string[], startIndex: number): boolean {
  return parseTable(lines, startIndex) !== null;
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

const TABLE_MIN_COLUMN_WIDTH = 8;

export function tableColumnWidths(table: MarkdownTable, maxWidth?: number): number[] {
  const formatted = formatTable(table);
  const widths = formatted.header.map((header, column) => {
    const rowMax = formatted.rows.reduce(
      (max, row) => Math.max(max, visibleWidth(row[column] ?? "")),
      0
    );
    const naturalWidth = Math.max(visibleWidth(header), rowMax);
    const maxColWidth = maxWidth ? Math.floor(maxWidth * 0.8) : 120;
    return Math.max(3, Math.min(maxColWidth, naturalWidth));
  });

  if (!maxWidth) return widths;

  while (tableTotalWidth(widths) > maxWidth) {
    let widest = TABLE_MIN_COLUMN_WIDTH;
    let widestIndex = -1;
    for (let index = 0; index < widths.length; index += 1) {
      const width = widths[index]!;
      if (width > TABLE_MIN_COLUMN_WIDTH && width > widest) {
        widest = width;
        widestIndex = index;
      }
    }
    if (widestIndex < 0) break;
    widths[widestIndex] = widths[widestIndex]! - 1;
  }

  return widths;
}

function renderBorder(left: string, middle: string, right: string, widths: number[]): string {
  return clr.border(`${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`);
}

function wrapCellLines(cell: string, colWidth: number): string[] {
  const formatted = formatInlineMarkdown(cell);
  if (!formatted.trim()) return [""];
  return wrapTextWithAnsi(formatted, colWidth);
}

function renderWideTableRowLines(
  row: string[],
  widths: number[],
  header: boolean
): string[] {
  const cellLines = widths.map((width, index) => wrapCellLines(row[index] ?? "", width));
  const lineCount = Math.max(...cellLines.map((lines) => lines.length), 1);
  const out: string[] = [];

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const cells = widths.map((width, colIndex) => {
      const line = cellLines[colIndex]![lineIndex] ?? "";
      const padded = padCell(line, width);
      const value = header && lineIndex === 0 ? clr.header(padded) : padded;
      return ` ${value} `;
    });
    out.push(`${clr.border("│")}${cells.join(clr.border("│"))}${clr.border("│")}`);
  }

  return out;
}

export function renderWideTable(table: MarkdownTable, widths: number[]): string[] {
  const formatted = formatTable(table);
  const lines: string[] = [
    renderBorder("┌", "┬", "┐", widths),
    ...renderWideTableRowLines(formatted.header, widths, true),
    renderBorder("├", "┼", "┤", widths),
  ];

  for (let rowIndex = 0; rowIndex < formatted.rows.length; rowIndex += 1) {
    const row = formatted.rows[rowIndex]!;
    lines.push(...renderWideTableRowLines(row, widths, false));
    if (rowIndex < formatted.rows.length - 1) {
      lines.push(renderBorder("├", "┼", "┤", widths));
    }
  }

  lines.push(renderBorder("└", "┴", "┘", widths));
  return lines;
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
      const value = formatInlineMarkdown(row[column] ?? "");
      const headerLabel = formatInlineMarkdown(table.header[column] ?? "");

      if (useTwoLineFields) {
        const label = truncateToWidth(headerLabel, Math.max(8, width - 2));
        lines.push(`  ${clr.dim(label)}`);
        const wrapped = wrapTextWithAnsi(value.length > 0 ? value : " ", Math.max(8, width - 4));
        for (const wrappedLine of wrapped) {
          lines.push(`    ${wrappedLine}`);
        }
        continue;
      }

      const label = padCell(headerLabel, labelWidth);
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

export type TableLayoutMode = "wide" | "stacked";

export function resolveTableLayoutMode(table: MarkdownTable, width: number): TableLayoutMode {
  const widths = tableColumnWidths(table, width);
  return tableTotalWidth(widths) <= width ? "wide" : "stacked";
}

export function renderTable(
  table: MarkdownTable,
  width: number,
  layout?: TableLayoutMode
): string[] {
  const mode = layout ?? resolveTableLayoutMode(table, width);
  if (mode === "wide") {
    const widths = tableColumnWidths(table, width);
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

const HELP_TABLE_GUTTER = 2;
const HELP_TABLE_MIN_HALF_WIDTH = 36;
const HELP_TABLE_BORDER_OVERHEAD = 7;

/** Column widths so the boxed table fits within maxWidth (2-column layout). */
export function helpTableColumnWidths(
  defs: SlashCommandDef[],
  maxWidth: number
): [number, number] {
  const cmdW = Math.max(
    7,
    visibleWidth("Command"),
    ...(defs.length > 0 ? defs.map((d) => visibleWidth(d.cmd)) : [0])
  );
  const minDesc = 8;
  let descW = Math.max(minDesc, maxWidth - cmdW - HELP_TABLE_BORDER_OVERHEAD);
  while (descW > minDesc && tableTotalWidth([cmdW, descW]) > maxWidth) {
    descW -= 1;
  }
  while (tableTotalWidth([cmdW, descW]) > maxWidth && descW > 3) {
    descW -= 1;
  }
  return [cmdW, descW];
}

/** Pad a rendered table line to a fixed visible width for side-by-side merge. */
export function padTableLineToWidth(line: string, width: number): string {
  const plainLen = visibleWidth(stripAnsi(line));
  if (plainLen >= width) return line;
  return `${line}${" ".repeat(width - plainLen)}`;
}

/** Pad or truncate so each half of a merged row fits halfWidth. */
export function fitTableLineToWidth(line: string, width: number): string {
  const plainLen = visibleWidth(stripAnsi(line));
  const fitted = plainLen > width ? truncateToWidth(line, width) : line;
  return padTableLineToWidth(fitted, width);
}

/** Place two table render passes on one row each (for dual-column /help). */
export function mergeTableLinesSideBySide(
  left: string[],
  right: string[],
  halfWidth: number,
  gutter = HELP_TABLE_GUTTER
): string[] {
  const gap = " ".repeat(gutter);
  const rows = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = fitTableLineToWidth(left[i] ?? "", halfWidth);
    const rawRight = i < right.length ? (right[i] ?? "") : "";
    const r = rawRight
      ? fitTableLineToWidth(rawRight, halfWidth)
      : padTableLineToWidth("", halfWidth);
    lines.push(`${l}${gap}${r}`);
  }
  return lines;
}

/**
 * Single bordered Command | Description table; descriptions wrap (no ellipsis).
 */
export function renderHelpCommandsTableSingle(
  defs: SlashCommandDef[],
  innerWidth: number
): string[] {
  if (defs.length === 0) return [];

  const widths = helpTableColumnWidths(defs, innerWidth);
  const descW = widths[1];

  const lines: string[] = [
    renderBorder("┌", "┬", "┐", widths),
    renderWideTableRow(["Command", "Description"], widths, true),
    renderBorder("├", "┼", "┤", widths),
  ];

  for (let defIndex = 0; defIndex < defs.length; defIndex += 1) {
    const def = defs[defIndex]!;
    const detail = formatInlineMarkdown(helpDetail(def));
    const descLines = wrapTextWithAnsi(detail.length > 0 ? detail : " ", descW);
    const rows = descLines.length > 0 ? descLines : [""];

    for (let i = 0; i < rows.length; i++) {
      const cmd = i === 0 ? def.cmd : "";
      lines.push(renderWideTableRow([cmd, rows[i] ?? ""], widths, false));
    }

    if (defIndex < defs.length - 1) {
      lines.push(renderBorder("├", "┼", "┤", widths));
    }
  }

  lines.push(renderBorder("└", "┴", "┘", widths));
  return lines;
}

/**
 * Two Command | Description tables side by side (or stacked when too narrow).
 */
export function renderHelpCommandsDualColumn(
  defs: SlashCommandDef[],
  innerWidth: number
): string[] {
  if (defs.length === 0) return [];

  const mid = Math.ceil(defs.length / 2);
  const leftDefs = defs.slice(0, mid);
  const rightDefs = defs.slice(mid);

  const minDual = 2 * HELP_TABLE_MIN_HALF_WIDTH + HELP_TABLE_GUTTER;
  if (innerWidth < minDual) {
    const left = renderHelpCommandsTableSingle(leftDefs, innerWidth);
    const right = renderHelpCommandsTableSingle(rightDefs, innerWidth);
    if (rightDefs.length === 0) return left;
    return [...left, "", ...right];
  }

  const half = Math.floor((innerWidth - HELP_TABLE_GUTTER) / 2);
  const left = renderHelpCommandsTableSingle(leftDefs, half);
  if (rightDefs.length === 0) {
    return left;
  }

  const right = renderHelpCommandsTableSingle(rightDefs, half);
  return mergeTableLinesSideBySide(left, right, half, HELP_TABLE_GUTTER);
}

/**
 * Help /help command tables: dual column when wide, wrapped boxed tables only.
 */
export function renderHelpCommandsTable(
  defs: SlashCommandDef[],
  innerWidth: number
): string[] {
  return renderHelpCommandsDualColumn(defs, innerWidth);
}
