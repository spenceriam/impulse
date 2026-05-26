import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import {
  bgLine,
  maxListRowsForHeight,
  overlayAnsi,
  overlayBottomBorder,
  overlayDim,
  overlayEmptyLine,
  overlayMuted,
  overlayTitleLine,
  OVERLAY_SELECT_BG,
  OVERLAY_SELECT_FG,
  padToWidth,
} from "./overlay-theme.js";

export interface SelectableListRow {
  id: string;
  /** Primary label (plain text; styled at render time). */
  label: string;
  /** Optional right column (model · date, etc.). */
  secondary?: string;
}

export interface SelectableListOverlayOptions {
  title: string;
  rows?: SelectableListRow[];
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  helpLines?: string[];
  /** Total overlay height budget (pi-tui maxHeight). */
  maxHeight?: number;
  maxVisibleRows?: number;
}

interface DisplayLine {
  rowIndex: number;
  inner: string;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function padSelectedLine(inner: string, innerWidth: number): string {
  const plainLen = visibleWidth(stripAnsi(inner));
  const pad = Math.max(0, innerWidth - plainLen);
  return overlayAnsi.bg(
    OVERLAY_SELECT_BG,
    overlayAnsi.fg(OVERLAY_SELECT_FG, `${inner}${" ".repeat(pad)}`)
  );
}

function formatRowDisplayLines(
  row: SelectableListRow,
  innerWidth: number,
  isSelected: boolean
): string[] {
  const oneLineLabel = row.label.replace(/[\r\n]+/g, " ").trim();

  if (row.id.startsWith("__header__")) {
    const inner = `  ${isSelected ? overlayAnsi.fg(39, oneLineLabel) : overlayMuted(oneLineLabel)}`;
    return [isSelected ? padSelectedLine(inner, innerWidth) : inner];
  }

  const pointer = isSelected ? overlayAnsi.fg(39, ">") : " ";
  const prefix = `  ${pointer} `;
  const prefixCols = visibleWidth(stripAnsi(prefix));
  const contIndent = " ".repeat(prefixCols);

  const primaryStyled = (part: string) =>
    isSelected ? part : overlayMuted(part);

  const lines: string[] = [];
  const primaryWidth = Math.max(8, innerWidth - prefixCols);
  const wrappedPrimary = wrapTextWithAnsi(oneLineLabel, primaryWidth);

  for (let i = 0; i < wrappedPrimary.length; i++) {
    const part = wrappedPrimary[i]!;
    const body =
      i === 0
        ? `${prefix}${primaryStyled(part)}`
        : `${contIndent}${primaryStyled(part)}`;
    lines.push(isSelected ? padSelectedLine(body, innerWidth) : body);
  }

  const secondary = row.secondary?.trim() ?? "";
  if (secondary) {
    const secBody = `${contIndent}${overlayDim(secondary)}`;
    lines.push(isSelected ? padSelectedLine(secBody, innerWidth) : secBody);
  }

  return lines.length > 0 ? lines : [isSelected ? padSelectedLine(prefix, innerWidth) : prefix];
}

export class SelectableListOverlay implements Component {
  private title: string;
  private rows: SelectableListRow[];
  private loading: boolean;
  private loadingMessage: string;
  private emptyMessage: string;
  private helpLines: string[];
  /** Max content display lines (wrapped lines count toward budget). */
  private maxDisplayLines: number;
  private searchQuery = "";
  private filtered: SelectableListRow[];
  private selectedIndex = 0;

  onSelect?: (id: string) => void;
  onCancel?: () => void;

  constructor(opts: SelectableListOverlayOptions) {
    this.title = opts.title;
    this.rows = opts.rows ?? [];
    this.loading = opts.loading ?? false;
    this.loadingMessage = opts.loadingMessage ?? "  Discovering…";
    this.emptyMessage = opts.emptyMessage ?? "  No items";
    this.helpLines = opts.helpLines ?? [
      "↑/↓ navigate   Type to filter   Enter select   Esc cancel",
    ];
    const fromHeight =
      opts.maxHeight != null
        ? maxListRowsForHeight(opts.maxHeight, this.helpLines.length)
        : undefined;
    this.maxDisplayLines = opts.maxVisibleRows ?? fromHeight ?? 10;
    this.filtered = [...this.rows];
  }

  setRows(rows: SelectableListRow[]): void {
    this.rows = rows;
    this.loading = false;
    this.applyFilter();
  }

  setLoading(loading: boolean, message?: string): void {
    this.loading = loading;
    if (message) this.loadingMessage = message;
  }

  invalidate(): void {}

  private rowSearchText(row: SelectableListRow): string {
    return `${row.label} ${row.secondary ?? ""}`.toLowerCase();
  }

  private applyFilter(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filtered = [...this.rows];
    } else {
      this.filtered = this.rows.filter((r) =>
        this.rowSearchText(r).includes(q)
      );
    }
    if (this.selectedIndex >= this.filtered.length) {
      this.selectedIndex = Math.max(0, this.filtered.length - 1);
    }
    this.ensureValidSelection();
  }

  private ensureValidSelection(): void {
    if (this.filtered.length === 0) return;
    
    const current = this.filtered[this.selectedIndex];
    if (!current?.id.startsWith("__header__")) return;
    
    // Try moving forward first
    let forward = this.selectedIndex + 1;
    while (forward < this.filtered.length) {
      if (!this.filtered[forward]?.id.startsWith("__header__")) {
        this.selectedIndex = forward;
        return;
      }
      forward++;
    }
    
    // If no selectable row forward, try backward
    let backward = this.selectedIndex - 1;
    while (backward >= 0) {
      if (!this.filtered[backward]?.id.startsWith("__header__")) {
        this.selectedIndex = backward;
        return;
      }
      backward--;
    }
    
    // If all rows are headers (edge case), stay at current position
    // (Enter will correctly do nothing on a header)
  }

  private buildDisplayLines(innerWidth: number): DisplayLine[] {
    const out: DisplayLine[] = [];
    for (let ri = 0; ri < this.filtered.length; ri++) {
      const row = this.filtered[ri]!;
      const isSelected = ri === this.selectedIndex;
      for (const inner of formatRowDisplayLines(row, innerWidth, isSelected)) {
        out.push({ rowIndex: ri, inner });
      }
    }
    return out;
  }

  handleInput(data: string): void {
    if (data === "\r") {
      const selected = this.filtered[this.selectedIndex];
      if (selected && !selected.id.startsWith("__header__")) {
        this.onSelect?.(selected.id);
      }
      return;
    }

    if (data === "\x1b") {
      this.onCancel?.();
      return;
    }

    if (data === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.ensureValidSelection();
      return;
    }

    if (data === "\x1b[B") {
      if (this.filtered.length === 0) return;
      this.selectedIndex = Math.min(
        this.filtered.length - 1,
        this.selectedIndex + 1
      );
      this.ensureValidSelection();
      return;
    }

    if (data === "\x7f" || data === "\b") {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.applyFilter();
      }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.searchQuery += data;
      this.applyFilter();
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines: string[] = [];

    lines.push(overlayTitleLine(this.title, boxWidth));
    lines.push(overlayEmptyLine(boxWidth));

    const searchText = this.searchQuery
      ? `${overlayDim("Search:")} ${this.searchQuery}_`
      : `${overlayDim("Search:")} _`;
    lines.push(bgLine(`│ ${padToWidth(searchText, innerWidth)} │`, boxWidth));
    lines.push(overlayEmptyLine(boxWidth));

    if (this.loading) {
      lines.push(
        bgLine(
          `│ ${padToWidth(overlayDim(this.loadingMessage), innerWidth)} │`,
          boxWidth
        )
      );
    } else if (this.rows.length === 0) {
      lines.push(
        bgLine(
          `│ ${padToWidth(overlayDim(this.emptyMessage), innerWidth)} │`,
          boxWidth
        )
      );
    } else if (this.filtered.length === 0) {
      lines.push(
        bgLine(
          `│ ${padToWidth(overlayDim(`  No matches for "${this.searchQuery}"`), innerWidth)} │`,
          boxWidth
        )
      );
    } else {
      const allDisplay = this.buildDisplayLines(innerWidth);
      let selectedLineIdx = allDisplay.findIndex(
        (d) => d.rowIndex === this.selectedIndex
      );
      if (selectedLineIdx < 0) selectedLineIdx = 0;

      const maxLines = this.maxDisplayLines;
      const scrollStart = Math.max(
        0,
        Math.min(
          selectedLineIdx - Math.floor(maxLines / 2),
          Math.max(0, allDisplay.length - maxLines)
        )
      );

      for (
        let i = scrollStart;
        i < scrollStart + maxLines && i < allDisplay.length;
        i++
      ) {
        const { inner } = allDisplay[i]!;
        lines.push(bgLine(`│ ${padToWidth(inner, innerWidth)} │`, boxWidth));
      }
    }

    lines.push(overlayEmptyLine(boxWidth));

    for (const helpLine of this.helpLines) {
      lines.push(
        bgLine(`│ ${padToWidth(overlayDim(helpLine), innerWidth)} │`, boxWidth)
      );
    }

    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}

/** @internal test helper — display line count for a row at width */
export function rowDisplayLineCount(
  row: SelectableListRow,
  innerWidth: number,
  isSelected = false
): number {
  return formatRowDisplayLines(row, innerWidth, isSelected).length;
}
