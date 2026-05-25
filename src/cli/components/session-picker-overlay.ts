import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@mariozechner/pi-tui";
import type { Session } from "../../session/store.js";
import { overlayBoxWidth } from "../layout.js";

const DARK_BG = "\x1b[48;5;233m";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};

const dimText = (s: string) => A.fg(90, s);
const highlight = (s: string) => A.fg(36, s);

function padToWidth(line: string, width: number): string {
  const truncated = truncateToWidth(line, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return `${truncated}${" ".repeat(padding)}`;
}

function bgLine(line: string, width: number): string {
  const padded = padToWidth(line, width).replace(/\x1b\[0m/g, `${A.reset}${DARK_BG}`);
  return `${DARK_BG}${padded}${A.reset}`;
}

export class SessionPickerOverlay implements Component {
  private readonly sessions: Session[];
  private selectedIndex: number;
  private searchQuery = "";
  private filtered: Session[];

  onSelect?: (sessionID: string) => void;
  onCancel?: () => void;

  constructor(sessions: Session[]) {
    this.sessions = sessions;
    this.filtered = [...sessions];
    this.selectedIndex = 0;
  }

  invalidate(): void {}

  private relativeTime(iso: string): string {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  private applyFilter(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filtered = [...this.sessions];
    } else {
      this.filtered = this.sessions.filter((s) => {
        const name = (s.headerTitle ?? s.name).toLowerCase();
        const model = s.model?.toLowerCase() ?? "";
        return name.includes(q) || model.includes(q);
      });
    }
    // Clamp selection
    if (this.selectedIndex >= this.filtered.length) {
      this.selectedIndex = Math.max(0, this.filtered.length - 1);
    }
  }

  handleInput(data: string): void {
    if (data === "\r") {
      const selected = this.filtered[this.selectedIndex];
      if (selected) {
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
      return;
    }

    if (data === "\x1b[B") {
      this.selectedIndex = Math.min(
        this.filtered.length - 1,
        this.selectedIndex + 1
      );
      return;
    }

    if (data === "\x7f" || data === "\b") {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.applyFilter();
      }
      return;
    }

    // Regular character — append to search
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.searchQuery += data;
      this.applyFilter();
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines: string[] = [];

    // Top border
    lines.push(bgLine(`┌─ Continue session ─${"─".repeat(Math.max(0, boxWidth - 22))}┐`, boxWidth));
    lines.push(bgLine("│" + " ".repeat(boxWidth - 2) + "│", boxWidth));

    // Search bar
    const searchPlaceholder = this.searchQuery
      ? `Search: ${this.searchQuery}_`
      : "Search: _";
    lines.push(bgLine(`│ ${padToWidth(searchPlaceholder, innerWidth)} │`, boxWidth));
    lines.push(bgLine("│" + " ".repeat(boxWidth - 2) + "│", boxWidth));

    // Session list
    if (this.filtered.length === 0) {
      const msg = this.sessions.length === 0
        ? dimText("  No saved sessions in this project")
        : dimText("  No matching sessions");
      lines.push(bgLine(`│ ${padToWidth(msg, innerWidth)} │`, boxWidth));
    } else {
      // Calculate visible rows
      const visibleRows = Math.min(
        this.filtered.length,
        12 // max visible rows
      );
      const scrollOffset = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(visibleRows / 2),
          this.filtered.length - visibleRows
        )
      );

      for (let i = scrollOffset; i < scrollOffset + visibleRows && i < this.filtered.length; i++) {
        const s = this.filtered[i]!;
        const isSelected = i === this.selectedIndex;
        const title = s.headerTitle ?? s.name;
        const model = s.model
          ? s.model.replace(/^(ollama|openrouter|openai|z\.ai|anthropic|groq|gemini|nous)\//, "")
          : "unknown";
        const time = this.relativeTime(s.updated_at);
        const line = isSelected
          ? `  > ${title} ${dimText("—")} ${model}  ${dimText("·")} ${time}`
          : `    ${title} ${dimText("—")} ${model}  ${dimText("·")} ${time}`;
        const styled = isSelected ? highlight(line) : line;
        lines.push(bgLine(`│ ${padToWidth(styled, innerWidth)} │`, boxWidth));
      }
    }

    lines.push(bgLine("│" + " ".repeat(boxWidth - 2) + "│", boxWidth));

    // Help text
    const helpLines = innerWidth < 50
      ? ["↑/↓ navigate", "Type filter · Enter · Esc"]
      : ["↑/↓ navigate   Type to filter   Enter continue   Esc cancel"];
    for (const helpLine of helpLines) {
      lines.push(bgLine(`│ ${padToWidth(dimText(helpLine), innerWidth)} │`, boxWidth));
    }

    // Bottom border
    lines.push(bgLine(`└${"─".repeat(boxWidth - 2)}┘`, boxWidth));

    return lines;
  }
}
