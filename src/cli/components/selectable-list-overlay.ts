import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";
import {
  computeListOverlayContentBoxWidth,
  overlayBoxWidth,
  resolveSessionPickerOverlayWidth,
  type ListOverlayContentMeasure,
} from "../layout.js";
import {
  maxListRowsForHeight,
  measureOverlayTopChromeWidth,
  overlayAnsi,
  overlayBottomBorder,
  overlayDim,
  overlayEmptyLine,
  overlayMuted,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
  OVERLAY_SELECT_BG,
  OVERLAY_SELECT_FG,
} from "./overlay-theme.js";

export interface SelectableListTableCells {
  title: string;
  mode: string;
  model: string;
  updated: string;
}

export interface SelectableListTableHeaders {
  title: string;
  mode: string;
  model: string;
  updated: string;
}

export interface SelectableListRow {
  id: string;
  /** Primary label (plain text; styled at render time). */
  label: string;
  /** Optional right-aligned metadata on the first line (mode · model · time). */
  metaRight?: string;
  /** Optional stacked line below primary (legacy; model picker unused). */
  secondary?: string;
  /** Structured columns for table layout (session picker). */
  tableCells?: SelectableListTableCells;
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
  /** Shrink panel to content up to terminal cap (resume picker). */
  boxSizing?: "full" | "content" | "responsive";
  /** Table columns with headers (resume picker). */
  layout?: "list" | "table";
  tableHeaders?: SelectableListTableHeaders;
  /** Model picker: title | Ctx | Added (no middle Model column). */
  tableOmitModelColumn?: boolean;
}

interface DisplayLine {
  rowIndex: number;
  inner: string;
}

interface TableColumnWidths {
  session: number;
  mode: number;
  model: number;
  updated: number;
}

export interface TableLayout {
  widths: TableColumnWidths;
  innerWidth: number;
}

const TABLE_COL_SEP = "  ";
const TABLE_MODE_MIN = 6;
const TABLE_UPDATED_MIN = 9;
const TABLE_MODEL_MAX = 32;
const TABLE_SESSION_MIN = 12;
export const TABLE_HEADER_ROW_ID = "__header__table__";

const DEFAULT_TABLE_HEADERS: SelectableListTableHeaders = {
  title: "Session",
  mode: "Mode",
  model: "Model",
  updated: "Updated",
};

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function isNonSelectableRowId(id: string | undefined): boolean {
  if (!id) return true;
  return id.startsWith("__header__") || id.startsWith("__sep__");
}

function padSelectedLine(inner: string, innerWidth: number): string {
  const plainLen = visibleWidth(stripAnsi(inner));
  const pad = Math.max(0, innerWidth - plainLen);
  return overlayAnsi.bg(
    OVERLAY_SELECT_BG,
    overlayAnsi.fg(OVERLAY_SELECT_FG, `${inner}${" ".repeat(pad)}`)
  );
}

function padTableCell(
  text: string,
  width: number,
  allowEllipsis: boolean
): string {
  const plainLen = visibleWidth(stripAnsi(text));
  if (plainLen <= width) {
    return `${text}${" ".repeat(width - plainLen)}`;
  }
  if (allowEllipsis) {
    return truncateToWidth(text, width);
  }
  const wrapped = wrapTextWithAnsi(text, width);
  const first = wrapped[0] ?? "";
  const firstLen = visibleWidth(stripAnsi(first));
  return `${first}${" ".repeat(Math.max(0, width - firstLen))}`;
}

/** Content-driven table columns; session width from titles, not flex-fill. */
export function computeTableLayout(
  headers: SelectableListTableHeaders,
  rows: SelectableListRow[],
  terminalCapInner: number,
  prefixCols = visibleWidth(stripAnsi("  > ")),
  omitModelColumn = false
): TableLayout {
  const dataRows = rows.filter(
    (r) => r.tableCells && !isNonSelectableRowId(r.id)
  );

  let modeW = Math.max(TABLE_MODE_MIN, visibleWidth(headers.mode));
  let updatedW = Math.max(TABLE_UPDATED_MIN, visibleWidth(headers.updated));
  let modelW = visibleWidth(headers.model);
  let sessionW = visibleWidth(headers.title);

  for (const row of dataRows) {
    const c = row.tableCells!;
    modeW = Math.max(modeW, visibleWidth(c.mode));
    updatedW = Math.max(updatedW, visibleWidth(c.updated));
    modelW = Math.max(modelW, visibleWidth(c.model));
    sessionW = Math.max(
      sessionW,
      visibleWidth(c.title.replace(/[\r\n]+/g, " ").trim())
    );
  }

  if (omitModelColumn) {
    modelW = 0;
  } else {
    modelW = Math.min(TABLE_MODEL_MAX, Math.max(8, modelW));
  }
  modeW = Math.max(modeW, TABLE_MODE_MIN);
  updatedW = Math.max(updatedW, TABLE_UPDATED_MIN);
  sessionW = Math.max(TABLE_SESSION_MIN, sessionW);

  const sepW = visibleWidth(TABLE_COL_SEP);
  const metaBlockW =
    modeW +
    updatedW +
    (omitModelColumn ? sepW : modelW + sepW * 3);
  const headerPrefix = visibleWidth(stripAnsi("    "));
  let innerWidth =
    headerPrefix + visibleWidth(headers.title) + sepW + metaBlockW;

  for (const row of dataRows) {
    const c = row.tableCells!;
    const titleLen = visibleWidth(c.title.replace(/[\r\n]+/g, " ").trim());
    const rowW = prefixCols + titleLen + 1 + sepW + metaBlockW;
    innerWidth = Math.max(innerWidth, rowW);
  }

  sessionW = Math.max(
    TABLE_SESSION_MIN,
    sessionW,
    visibleWidth(headers.title)
  );

  if (innerWidth > terminalCapInner) {
    innerWidth = terminalCapInner;
  }

  return {
    widths: { session: sessionW, mode: modeW, model: modelW, updated: updatedW },
    innerWidth,
  };
}

function formatTableHeaderLine(
  headers: SelectableListTableHeaders,
  widths: TableColumnWidths,
  innerWidth: number,
  omitModelColumn = false
): string {
  const prefix = "    ";
  const title = padTableCell(overlayDim(headers.title), widths.session, true);
  const mode = padTableCell(overlayDim(headers.mode), widths.mode, true);
  const updated = padTableCell(overlayDim(headers.updated), widths.updated, true);
  if (omitModelColumn) {
    return `${prefix}${title}${TABLE_COL_SEP}${mode}${TABLE_COL_SEP}${updated}`;
  }
  const model = padTableCell(overlayDim(headers.model), widths.model, true);
  return `${prefix}${title}${TABLE_COL_SEP}${mode}${TABLE_COL_SEP}${model}${TABLE_COL_SEP}${updated}`;
}

function formatTableRowDisplayLines(
  row: SelectableListRow,
  widths: TableColumnWidths,
  innerWidth: number,
  isSelected: boolean,
  omitModelColumn = false
): string[] {
  const cells = row.tableCells!;
  const pointer = isSelected ? overlayAnsi.fg(39, ">") : " ";
  const prefix = `  ${pointer} `;
  const prefixCols = visibleWidth(stripAnsi(prefix));
  const contIndent = " ".repeat(prefixCols);
  const sepW = visibleWidth(TABLE_COL_SEP);

  const modeCell = padTableCell(
    isSelected ? cells.mode : overlayMuted(cells.mode),
    widths.mode,
    false
  );
  const updatedCell = padTableCell(
    isSelected ? cells.updated : overlayDim(cells.updated),
    widths.updated,
    false
  );
  const modelCell = omitModelColumn
    ? ""
    : padTableCell(
        isSelected ? cells.model : overlayDim(cells.model),
        widths.model,
        false
      );
  const metaBlock = omitModelColumn
    ? `${modeCell}${TABLE_COL_SEP}${updatedCell}`
    : `${modeCell}${TABLE_COL_SEP}${modelCell}${TABLE_COL_SEP}${updatedCell}`;
  const metaWidth = visibleWidth(stripAnsi(metaBlock));

  const titlePlain = cells.title.replace(/[\r\n]+/g, " ").trim();
  const titleWidth = Math.max(
    8,
    innerWidth - prefixCols - metaWidth - sepW
  );
  const titleWrapped = wrapTextWithAnsi(titlePlain, titleWidth);

  const lines: string[] = [];

  for (let i = 0; i < titleWrapped.length; i++) {
    const titlePart = titleWrapped[i]!;
    const styledTitle = isSelected ? titlePart : overlayMuted(titlePart);

    if (i === 0) {
      const titleLen = visibleWidth(stripAnsi(styledTitle));
      const gap = Math.max(
        1,
        innerWidth - prefixCols - titleLen - sepW - metaWidth
      );
      const body = `${prefix}${styledTitle}${" ".repeat(gap)}${TABLE_COL_SEP}${metaBlock}`;
      lines.push(isSelected ? padSelectedLine(body, innerWidth) : body);
    } else {
      const body = `${contIndent}${styledTitle}`;
      const pad = Math.max(0, innerWidth - visibleWidth(stripAnsi(body)));
      const padded = `${body}${" ".repeat(pad)}`;
      lines.push(isSelected ? padSelectedLine(padded, innerWidth) : padded);
    }
  }

  if (titleWrapped.length === 0) {
    const gap = Math.max(1, innerWidth - prefixCols - sepW - metaWidth);
    const body = `${prefix}${" ".repeat(gap)}${TABLE_COL_SEP}${metaBlock}`;
    lines.push(isSelected ? padSelectedLine(body, innerWidth) : body);
  }

  return lines.length > 0 ? lines : [isSelected ? padSelectedLine(prefix, innerWidth) : prefix];
}

function formatRowDisplayLines(
  row: SelectableListRow,
  innerWidth: number,
  isSelected: boolean
): string[] {
  const oneLineLabel = row.label.replace(/[\r\n]+/g, " ").trim();

  if (row.id.startsWith("__header__") || row.id.startsWith("__sep__")) {
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
  const metaRight = row.metaRight?.trim() ?? "";

  if (metaRight) {
    const metaCols = visibleWidth(` ${metaRight}`);
    const titleWidth = Math.max(8, innerWidth - prefixCols - metaCols);
    const wrappedPrimary = wrapTextWithAnsi(oneLineLabel, titleWidth);

    for (let i = 0; i < wrappedPrimary.length; i++) {
      const part = wrappedPrimary[i]!;
      if (i === 0) {
        const titlePlainLen = visibleWidth(part);
        const padSpaces = Math.max(
          1,
          innerWidth - prefixCols - titlePlainLen - metaCols
        );
        const body = `${prefix}${primaryStyled(part)}${" ".repeat(padSpaces)}${overlayDim(metaRight)}`;
        lines.push(isSelected ? padSelectedLine(body, innerWidth) : body);
      } else {
        const body = `${contIndent}${primaryStyled(part)}`;
        const pad = Math.max(0, innerWidth - visibleWidth(stripAnsi(body)));
        lines.push(
          isSelected
            ? padSelectedLine(`${body}${" ".repeat(pad)}`, innerWidth)
            : `${body}${" ".repeat(pad)}`
        );
      }
    }

    if (wrappedPrimary.length === 0) {
      const padSpaces = Math.max(1, innerWidth - prefixCols - metaCols);
      const body = `${prefix}${" ".repeat(padSpaces)}${overlayDim(metaRight)}`;
      lines.push(isSelected ? padSelectedLine(body, innerWidth) : body);
    }

    return lines.length > 0 ? lines : [isSelected ? padSelectedLine(prefix, innerWidth) : prefix];
  }

  const primaryWidth = Math.max(8, innerWidth - prefixCols);
  const wrappedPrimary = wrapTextWithAnsi(oneLineLabel, primaryWidth);

  for (let i = 0; i < wrappedPrimary.length; i++) {
    const part = wrappedPrimary[i]!;
    const body =
      i === 0
        ? `${prefix}${primaryStyled(part)}`
        : `${contIndent}${primaryStyled(part)}`;
    const pad = Math.max(0, innerWidth - visibleWidth(stripAnsi(body)));
    lines.push(
      isSelected
        ? padSelectedLine(`${body}${" ".repeat(pad)}`, innerWidth)
        : `${body}${" ".repeat(pad)}`
    );
  }

  const secondary = row.secondary?.trim() ?? "";
  if (secondary) {
    const secBody = `${contIndent}${overlayDim(secondary)}`;
    const pad = Math.max(0, innerWidth - visibleWidth(stripAnsi(secBody)));
    lines.push(
      isSelected
        ? padSelectedLine(`${secBody}${" ".repeat(pad)}`, innerWidth)
        : `${secBody}${" ".repeat(pad)}`
    );
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
  private boxSizing: "full" | "content" | "responsive";
  private layout: "list" | "table";
  private tableHeaders: SelectableListTableHeaders;
  private tableOmitModelColumn: boolean;
  private measureTerminalWidth: number | null = null;
  private searchQuery = "";
  private filtered: SelectableListRow[];
  private selectedIndex = 0;

  onSelect?: (id: string) => void;
  onCancel?: () => void;
  onManageProviders?: () => void;

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
    this.boxSizing = opts.boxSizing ?? "full";
    this.layout = opts.layout ?? "list";
    this.tableHeaders = opts.tableHeaders ?? DEFAULT_TABLE_HEADERS;
    this.tableOmitModelColumn = opts.tableOmitModelColumn ?? false;
    this.filtered = [...this.rows];
  }

  private searchPlainText(): string {
    return this.searchQuery
      ? `Search: ${this.searchQuery}_`
      : "Search: _";
  }

  private contentMeasureParts(): ListOverlayContentMeasure {
    return {
      title: this.title,
      searchPlain: this.searchPlainText(),
      rows: this.filtered,
      helpLines: this.helpLines,
      tableHeaders: this.layout === "table" ? this.tableHeaders : undefined,
      emptyMessage: this.emptyMessage,
      loadingMessage: this.loadingMessage,
      loading: this.loading,
      rowsEmpty: this.rows.length === 0,
    };
  }

  private terminalWidthForCap(hostWidth: number): number {
    return this.measureTerminalWidth ?? hostWidth;
  }

  private intrinsicBoxWidth(terminalWidth: number, rows: SelectableListRow[]): number {
    return computeListOverlayContentBoxWidth(terminalWidth, {
      title: this.title,
      searchPlain: this.searchPlainText(),
      rows,
      helpLines: this.helpLines,
      tableHeaders: this.layout === "table" ? this.tableHeaders : undefined,
      emptyMessage: this.emptyMessage,
      loadingMessage: this.loadingMessage,
      loading: this.loading,
      rowsEmpty: this.rows.length === 0,
    });
  }

  /** Intrinsic content width for showOverlay sizing (not host render width). */
  private naturalContentDimensions(
    terminal: number,
    rows: SelectableListRow[]
  ): {
    boxWidth: number;
    innerWidth: number;
    tableLayout: TableLayout | null;
  } {
    const terminalCapInner = Math.max(20, overlayBoxWidth(terminal) - 4);
    const tableLayout =
      this.layout === "table" && rows.some((r) => r.tableCells)
        ? computeTableLayout(
            this.tableHeaders,
            rows,
            terminalCapInner,
            visibleWidth(stripAnsi("  > ")),
            this.tableOmitModelColumn
          )
        : null;

    let innerWidth = tableLayout
      ? tableLayout.innerWidth
      : Math.max(20, this.intrinsicBoxWidth(terminal, rows) - 4);

    const chromeWidths = [
      measureOverlayTopChromeWidth(this.title),
      visibleWidth(this.searchPlainText()),
      visibleWidth(this.emptyMessage),
      visibleWidth(this.loadingMessage),
      visibleWidth(`  No matches for "${this.searchQuery}"`),
      ...this.helpLines.map((h) => visibleWidth(h)),
    ];
    innerWidth = Math.max(innerWidth, ...chromeWidths, 20);

    const capBox = overlayBoxWidth(terminal);
    const boxWidth = Math.min(capBox, innerWidth + 4);
    innerWidth = Math.max(20, boxWidth - 4);
    return { boxWidth, innerWidth, tableLayout };
  }

  /** Render dimensions: box width matches pi-tui host width so borders align. */
  private resolvePanelDimensions(
    hostWidth: number,
    rows: SelectableListRow[]
  ): {
    boxWidth: number;
    innerWidth: number;
    tableLayout: TableLayout | null;
    terminal: number;
  } {
    const terminal = this.terminalWidthForCap(hostWidth);

    if (this.boxSizing === "full") {
      const boxWidth = overlayRenderBoxWidth(hostWidth);
      const innerWidth = Math.max(20, boxWidth - 4);
      return { boxWidth, innerWidth, tableLayout: null, terminal };
    }

    const natural = this.naturalContentDimensions(terminal, rows);
    const boxWidth = overlayRenderBoxWidth(hostWidth);
    const innerWidth = Math.min(
      natural.innerWidth,
      Math.max(20, boxWidth - 4)
    );
    return {
      boxWidth,
      innerWidth,
      tableLayout: natural.tableLayout,
      terminal,
    };
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.terminalWidthForCap(terminalWidth);
    if (this.boxSizing === "full") {
      return overlayBoxWidth(terminal);
    }
    return this.naturalContentDimensions(terminal, this.rows).boxWidth;
  }

  private framedContentLine(
    inner: string,
    innerWidth: number,
    boxWidth: number
  ): string {
    return overlaySideLine(inner, innerWidth, boxWidth);
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
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

  /** @internal */
  setSelectedIndexForTest(index: number): void {
    this.selectedIndex = index;
  }

  /** @internal */
  getDisplayInnerLines(terminalWidth: number): string[] {
    const { innerWidth } = this.resolvePanelDimensions(terminalWidth, this.filtered);
    return this.buildDisplayLines(terminalWidth, innerWidth).map((d) => d.inner);
  }

  private rowSearchText(row: SelectableListRow): string {
    if (row.tableCells) {
      const c = row.tableCells;
      return `${c.title} ${c.mode} ${c.model} ${c.updated}`.toLowerCase();
    }
    return `${row.label} ${row.metaRight ?? ""} ${row.secondary ?? ""}`.toLowerCase();
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

  private ensureValidSelection(preferBackward = false): void {
    if (this.filtered.length === 0) return;

    const current = this.filtered[this.selectedIndex];
    if (!isNonSelectableRowId(current?.id)) return;

    if (preferBackward) {
      let backward = this.selectedIndex - 1;
      while (backward >= 0) {
        if (!isNonSelectableRowId(this.filtered[backward]?.id)) {
          this.selectedIndex = backward;
          return;
        }
        backward--;
      }

      let forward = this.selectedIndex + 1;
      while (forward < this.filtered.length) {
        if (!isNonSelectableRowId(this.filtered[forward]?.id)) {
          this.selectedIndex = forward;
          return;
        }
        forward++;
      }
    } else {
      let forward = this.selectedIndex + 1;
      while (forward < this.filtered.length) {
        if (!isNonSelectableRowId(this.filtered[forward]?.id)) {
          this.selectedIndex = forward;
          return;
        }
        forward++;
      }

      let backward = this.selectedIndex - 1;
      while (backward >= 0) {
        if (!isNonSelectableRowId(this.filtered[backward]?.id)) {
          this.selectedIndex = backward;
          return;
        }
        backward--;
      }
    }
  }

  private buildDisplayLines(
    terminalWidth: number,
    panelInnerWidth: number
  ): DisplayLine[] {
    const out: DisplayLine[] = [];
    const terminalCapInner = Math.max(
      20,
      overlayBoxWidth(terminalWidth) - 4
    );

    if (this.layout === "table" && this.filtered.some((r) => r.tableCells)) {
      const { widths, innerWidth: tableInnerWidth } = computeTableLayout(
        this.tableHeaders,
        this.filtered,
        terminalCapInner,
        visibleWidth(stripAnsi("  > ")),
        this.tableOmitModelColumn
      );
      const innerWidth = tableInnerWidth;
      out.push({
        rowIndex: -1,
        inner: formatTableHeaderLine(
          this.tableHeaders,
          widths,
          innerWidth,
          this.tableOmitModelColumn
        ),
      });

      for (let ri = 0; ri < this.filtered.length; ri++) {
        const row = this.filtered[ri]!;
        const isSelected = ri === this.selectedIndex;
        if (!row.tableCells) {
          for (const inner of formatRowDisplayLines(row, innerWidth, isSelected)) {
            out.push({ rowIndex: ri, inner });
          }
        } else {
          for (const inner of formatTableRowDisplayLines(
            row,
            widths,
            innerWidth,
            isSelected,
            this.tableOmitModelColumn
          )) {
            out.push({ rowIndex: ri, inner });
          }
        }
      }
      return out;
    }

    const innerWidth = Math.max(
      20,
      resolveSessionPickerOverlayWidth(
        terminalWidth,
        this.intrinsicBoxWidth(terminalWidth, this.filtered)
      ) - 4
    );

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
      if (selected && !isNonSelectableRowId(selected.id)) {
        this.onSelect?.(selected.id);
      }
      return;
    }

    if (data === "\x1b") {
      this.onCancel?.();
      return;
    }

    if ((data === "m" || data === "M") && this.onManageProviders) {
      this.onManageProviders();
      return;
    }

    if (data === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.ensureValidSelection(true);
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
    const { boxWidth, innerWidth, terminal } = this.resolvePanelDimensions(
      width,
      this.filtered
    );
    const lines: string[] = [];

    lines.push(overlayTitleLine(this.title, boxWidth));
    lines.push(overlayEmptyLine(boxWidth));

    const searchText = this.searchQuery
      ? `${overlayDim("Search:")} ${this.searchQuery}_`
      : `${overlayDim("Search:")} _`;
    lines.push(
      this.framedContentLine(searchText, innerWidth, boxWidth)
    );
    lines.push(overlayEmptyLine(boxWidth));

    if (this.loading) {
      lines.push(
        this.framedContentLine(
          overlayDim(this.loadingMessage),
          innerWidth,
          boxWidth
        )
      );
    } else if (this.rows.length === 0) {
      lines.push(
        this.framedContentLine(
          overlayDim(this.emptyMessage),
          innerWidth,
          boxWidth
        )
      );
    } else if (this.filtered.length === 0) {
      lines.push(
        this.framedContentLine(
          overlayDim(`  No matches for "${this.searchQuery}"`),
          innerWidth,
          boxWidth
        )
      );
    } else {
      const allDisplay = this.buildDisplayLines(terminal, innerWidth);
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
        lines.push(this.framedContentLine(inner, innerWidth, boxWidth));
      }
    }

    lines.push(overlayEmptyLine(boxWidth));

    for (const helpLine of this.helpLines) {
      lines.push(
        this.framedContentLine(overlayDim(helpLine), innerWidth, boxWidth)
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
  isSelected = false,
  opts?: {
    layout?: "list" | "table";
    tableHeaders?: SelectableListTableHeaders;
    allRows?: SelectableListRow[];
  }
): number {
  if (opts?.layout === "table" && row.tableCells) {
    const headers = opts.tableHeaders ?? DEFAULT_TABLE_HEADERS;
    const { widths, innerWidth: tableInner } = computeTableLayout(
      headers,
      opts.allRows ?? [row],
      innerWidth
    );
    return formatTableRowDisplayLines(
      row,
      widths,
      tableInner,
      isSelected
    ).length;
  }
  return formatRowDisplayLines(row, innerWidth, isSelected).length;
}
