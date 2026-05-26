import type { Component } from "@mariozechner/pi-tui";
import type { Session } from "../../session/store.js";
import { formatModelDate } from "../model-catalog.js";
import {
  SelectableListOverlay,
  type SelectableListRow,
} from "./selectable-list-overlay.js";

const PROVIDER_PREFIX =
  /^(ollama|openrouter|openai|z\.ai|anthropic|groq|gemini|nous)\//;

function stripProviderPrefix(model: string): string {
  return model.replace(PROVIDER_PREFIX, "");
}

function sanitizeTitle(text: string, maxLen = 40): string {
  const oneLine = text.replace(/[\r\n]+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}

function sessionModelLabel(s: Session, defaultModel?: string): string {
  if (s.model) return stripProviderPrefix(s.model);
  if (defaultModel) return stripProviderPrefix(defaultModel);
  return "—";
}

function sessionToRow(s: Session, defaultModel?: string): SelectableListRow {
  const title = sanitizeTitle(s.headerTitle ?? s.name);
  const model = sessionModelLabel(s, defaultModel);
  const date = formatModelDate(s.updated_at);
  return {
    id: s.id,
    label: title,
    secondary: `${model}  ·  ${date}`,
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
