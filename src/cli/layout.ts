import { visibleWidth } from "@mariozechner/pi-tui";
import { TOTAL_GUTTER_WIDTH } from "./gutter.js";

/** Minimum usable overlay width on narrow split panes. */
export const OVERLAY_MIN_BOX_WIDTH = 24;

const LIST_ROW_SELECTED_PREFIX_COLS = 4; // `  > `
const TABLE_COL_SEP_COLS = 2;
const TABLE_MODE_MIN = 6;
const TABLE_UPDATED_MIN = 9;
const TABLE_MODEL_MAX = 32;
const TABLE_SESSION_MIN = 12;

export interface ListOverlayTableHeaders {
  title: string;
  mode: string;
  model: string;
  updated: string;
}

export interface ListOverlayContentMeasure {
  title: string;
  searchPlain: string;
  rows: Array<{
    id: string;
    label: string;
    metaRight?: string;
    secondary?: string;
    tableCells?: {
      title: string;
      mode: string;
      model: string;
      updated: string;
    };
  }>;
  helpLines: string[];
  tableHeaders?: ListOverlayTableHeaders;
  emptyMessage?: string;
  loadingMessage?: string;
  loading?: boolean;
  rowsEmpty?: boolean;
}

function tableMetaColumnWidths(
  headers: ListOverlayTableHeaders,
  row: NonNullable<ListOverlayContentMeasure["rows"][number]["tableCells"]>
): { modeW: number; modelW: number; updatedW: number; metaBlockW: number } {
  let modeW = Math.max(TABLE_MODE_MIN, visibleWidth(headers.mode), visibleWidth(row.mode));
  let updatedW = Math.max(
    TABLE_UPDATED_MIN,
    visibleWidth(headers.updated),
    visibleWidth(row.updated)
  );
  let modelW = Math.min(
    TABLE_MODEL_MAX,
    Math.max(8, visibleWidth(headers.model), visibleWidth(row.model))
  );
  modeW = Math.max(modeW, TABLE_MODE_MIN);
  updatedW = Math.max(updatedW, TABLE_UPDATED_MIN);
  const metaBlockW = modeW + modelW + updatedW + TABLE_COL_SEP_COLS * 3;
  return { modeW, modelW, updatedW, metaBlockW };
}

function tableRowNaturalInnerWidth(
  row: NonNullable<ListOverlayContentMeasure["rows"][number]["tableCells"]>,
  headers: ListOverlayTableHeaders
): number {
  const { metaBlockW } = tableMetaColumnWidths(headers, row);
  const titleLen = visibleWidth(row.title.replace(/[\r\n]+/g, " ").trim());
  return (
    LIST_ROW_SELECTED_PREFIX_COLS +
    titleLen +
    1 +
    TABLE_COL_SEP_COLS +
    metaBlockW
  );
}

/** Natural inner width for a list row (worst-case selected pointer). */
export function listRowNaturalInnerWidth(row: {
  id: string;
  label: string;
  metaRight?: string;
  secondary?: string;
  tableCells?: {
    title: string;
    mode: string;
    model: string;
    updated: string;
  };
}): number {
  if (row.tableCells) {
    const headers: ListOverlayTableHeaders = {
      title: "Session",
      mode: "Mode",
      model: "Model",
      updated: "Updated",
    };
    return tableRowNaturalInnerWidth(row.tableCells, headers);
  }

  const label = row.label.replace(/[\r\n]+/g, " ").trim();
  if (row.id.startsWith("__header__") || row.id.startsWith("__sep__")) {
    return LIST_ROW_SELECTED_PREFIX_COLS + visibleWidth(label);
  }
  const meta = row.metaRight?.trim() ?? "";
  if (meta) {
    return (
      LIST_ROW_SELECTED_PREFIX_COLS +
      visibleWidth(label) +
      1 +
      visibleWidth(meta)
    );
  }
  const secondary = row.secondary?.trim() ?? "";
  let width = LIST_ROW_SELECTED_PREFIX_COLS + visibleWidth(label);
  if (secondary) {
    width = Math.max(
      width,
      LIST_ROW_SELECTED_PREFIX_COLS + visibleWidth(secondary)
    );
  }
  return width;
}

/** Hint for tests/docs; sizing is always min(cap, intrinsic). */
export const SESSION_PICKER_NARROW_HINT_COLS = 80;

/**
 * Session picker overlay width: fit table content, never exceed terminal cap.
 */
export function resolveSessionPickerOverlayWidth(
  terminalWidth: number,
  intrinsicBoxWidth: number
): number {
  const cap = overlayBoxWidth(terminalWidth);
  return Math.max(
    OVERLAY_MIN_BOX_WIDTH,
    Math.min(cap, intrinsicBoxWidth)
  );
}

function computeTableIntrinsicInnerWidth(
  headers: ListOverlayTableHeaders,
  rows: ListOverlayContentMeasure["rows"],
  terminalCapInner: number
): number {
  const dataRows = rows.filter(
    (r) => r.tableCells && !r.id.startsWith("__header__") && !r.id.startsWith("__sep__")
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

  modelW = Math.min(TABLE_MODEL_MAX, Math.max(8, modelW));
  modeW = Math.max(modeW, TABLE_MODE_MIN);
  updatedW = Math.max(updatedW, TABLE_UPDATED_MIN);
  sessionW = Math.max(TABLE_SESSION_MIN, sessionW);

  const sepW = TABLE_COL_SEP_COLS;
  const metaBlockW = modeW + modelW + updatedW + sepW * 3;
  const headerPrefix = 4;
  let innerWidth =
    headerPrefix + visibleWidth(headers.title) + sepW + metaBlockW;

  for (const row of dataRows) {
    const c = row.tableCells!;
    const titleLen = visibleWidth(c.title.replace(/[\r\n]+/g, " ").trim());
    const rowW =
      LIST_ROW_SELECTED_PREFIX_COLS + titleLen + 1 + sepW + metaBlockW;
    innerWidth = Math.max(innerWidth, rowW);
  }

  if (innerWidth > terminalCapInner) {
    innerWidth = terminalCapInner;
  }

  return innerWidth;
}

/**
 * Overlay box width that fits list content, capped at terminal max minus gutters.
 */
export function computeListOverlayContentBoxWidth(
  terminalWidth: number,
  parts: ListOverlayContentMeasure
): number {
  const capBox = overlayBoxWidth(terminalWidth);
  const capInner = capBox - 4;

  let naturalInner = 20;
  naturalInner = Math.max(naturalInner, visibleWidth(parts.title) + 4);
  naturalInner = Math.max(naturalInner, visibleWidth(parts.searchPlain));

  if (parts.tableHeaders) {
    naturalInner = Math.max(
      naturalInner,
      computeTableIntrinsicInnerWidth(
        parts.tableHeaders,
        parts.rows,
        capInner
      )
    );
  } else {
    for (const row of parts.rows) {
      naturalInner = Math.max(naturalInner, listRowNaturalInnerWidth(row));
    }
  }

  for (const help of parts.helpLines) {
    naturalInner = Math.max(naturalInner, visibleWidth(help));
  }

  if (parts.loading && parts.loadingMessage) {
    naturalInner = Math.max(naturalInner, visibleWidth(parts.loadingMessage));
  }
  if (parts.rowsEmpty && parts.emptyMessage) {
    naturalInner = Math.max(naturalInner, visibleWidth(parts.emptyMessage));
  }

  const innerWidth = Math.max(20, naturalInner);
  const boxWidth = innerWidth + 4;
  return resolveSessionPickerOverlayWidth(terminalWidth, boxWidth);
}

/**
 * Compute overlay box width from terminal columns (full width minus gutters).
 */
export function overlayBoxWidth(terminalWidth: number): number {
  return Math.max(OVERLAY_MIN_BOX_WIDTH, terminalWidth - TOTAL_GUTTER_WIDTH);
}

/**
 * minWidth for pi-tui showOverlay — matches content width on narrow panes.
 */
export function overlayMinWidth(terminalWidth: number): number {
  return overlayBoxWidth(terminalWidth);
}

/** Gutter width in columns — tighter on very narrow terminals. */
export function gutterWidth(terminalWidth: number): number {
  return terminalWidth < 50 ? 2 : 4;
}

/** Left gutter string for the current terminal width. */
export function gutterForWidth(terminalWidth: number): string {
  return " ".repeat(gutterWidth(terminalWidth));
}
