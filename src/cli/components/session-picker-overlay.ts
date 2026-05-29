import type { Component } from "@mariozechner/pi-tui";
import type { Session } from "../../session/store.js";
import { normalizeMode } from "../../constants.js";
import { formatRelativeTimeAgo } from "../../util/relative-time.js";
import {
  SelectableListOverlay,
  type SelectableListRow,
  type SelectableListTableCells,
} from "./selectable-list-overlay.js";
import { visionStatusSuffix } from "../symbols.js";

const PROVIDER_PREFIX =
  /^(ollama|openrouter|openai|z\.ai|anthropic|groq|gemini|nous)\//;

function stripProviderPrefix(model: string): string {
  return model.replace(PROVIDER_PREFIX, "");
}

/** @internal */
export function flattenTitle(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function sessionModelLabel(s: Session, defaultModel?: string): string {
  let label: string;
  if (s.model) label = stripProviderPrefix(s.model);
  else if (defaultModel) label = stripProviderPrefix(defaultModel);
  else label = "—";
  if (s.advisorMode) label += " (adv)";
  if (s.visionMode) label += visionStatusSuffix();
  return label;
}

function sessionTableCells(
  s: Session,
  defaultModel?: string
): SelectableListTableCells {
  return {
    title: flattenTitle(s.headerTitle ?? s.name),
    mode: normalizeMode(s.mode),
    model: sessionModelLabel(s, defaultModel),
    updated: formatRelativeTimeAgo(s.updated_at),
  };
}

function sessionToRow(s: Session, defaultModel?: string): SelectableListRow {
  const cells = sessionTableCells(s, defaultModel);
  return {
    id: s.id,
    label: cells.title,
    tableCells: cells,
  };
}

export class SessionPickerOverlay implements Component {
  private inner: SelectableListOverlay;

  onSelect?: (sessionID: string) => void;
  onCancel?: () => void;

  constructor(
    sessions: Session[],
    opts?: { maxHeight?: number; defaultModel?: string }
  ) {
    const rows: SelectableListRow[] = sessions.map((s) =>
      sessionToRow(s, opts?.defaultModel)
    );

    this.inner = new SelectableListOverlay({
      title: "Resume session",
      rows,
      layout: "table",
      boxSizing: "responsive",
      maxHeight: opts?.maxHeight ?? 18,
      emptyMessage: "  No saved sessions in this project",
      helpLines: [
        "↑/↓ navigate   Type to filter   Enter resume   Esc cancel",
      ],
    });

    this.inner.onSelect = (id) => this.onSelect?.(id);
    this.inner.onCancel = () => this.onCancel?.();
  }

  invalidate(): void {
    this.inner.invalidate();
  }

  handleInput(data: string): void {
    this.inner.handleInput(data);
  }

  preferredBoxWidth(terminalWidth: number): number {
    return this.inner.preferredBoxWidth(terminalWidth);
  }

  setMeasureTerminalWidth(cols: number): void {
    this.inner.setMeasureTerminalWidth(cols);
  }

  render(width: number): string[] {
    return this.inner.render(width);
  }
}

/** @internal test helper */
export function sessionRowForTest(
  s: Session,
  defaultModel?: string
): SelectableListRow {
  return sessionToRow(s, defaultModel);
}

/** @internal test helper */
export function sessionTableCellsForTest(
  s: Session,
  defaultModel?: string
): SelectableListTableCells {
  return sessionTableCells(s, defaultModel);
}
