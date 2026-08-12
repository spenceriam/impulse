import { visibleWidth, type Component } from "@mariozechner/pi-tui";
import {
  intrinsicFramedBoxWidth,
  overlayAnsi,
  overlayBottomBorder,
  overlayEmptyLine,
  overlayMuted,
  overlayPushWrapped,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
  OVERLAY_SELECT_BG,
  OVERLAY_SELECT_FG,
} from "./overlay-theme.js";

export interface ExperimentalFlags {
  advisor: boolean;
  undo: boolean;
  goal: boolean;
}

export interface ExperimentalOverlayOptions {
  flags: ExperimentalFlags;
}

export class ExperimentalOverlay implements Component {
  private flags: ExperimentalFlags;
  private selectedIndex = 0;
  private measureTerminalWidth: number | null = null;

  private readonly rows: Array<{ key: keyof ExperimentalFlags; label: string; hint: string }> = [
    {
      key: "advisor",
      label: "Advisor workflow",
      hint: "Strategic advisor + consult_advisor (experimental)",
    },
    {
      key: "undo",
      label: "Undo / redo",
      hint: "Git checkpoint rewind + chat trim (/undo, /redo)",
    },
    {
      key: "goal",
      label: "Goal loop",
      hint: "Hermes-style /goal autonomous loop (experimental)",
    },
  ];

  onSubmit?: (flags: ExperimentalFlags) => void;
  onAbort?: () => void;

  constructor(opts: ExperimentalOverlayOptions) {
    this.flags = { ...opts.flags };
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const widths = [
      visibleWidth("These features may break sessions. Enable only for testing."),
      visibleWidth("[ ] Goal loop"),
      visibleWidth("Hermes-style /goal autonomous loop (experimental)"),
      visibleWidth("Space: toggle   Enter: save   Esc: cancel"),
    ];
    return intrinsicFramedBoxWidth(terminal, "Experimental features", widths);
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b") {
      this.onAbort?.();
      return;
    }
    if (data === "\r") {
      this.onSubmit?.({ ...this.flags });
      return;
    }
    if (data === "\x1b[A" || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (data === "\x1b[B" || data === "j") {
      this.selectedIndex = Math.min(this.rows.length - 1, this.selectedIndex + 1);
      return;
    }
    if (data === " ") {
      const row = this.rows[this.selectedIndex];
      if (row) {
        this.flags[row.key] = !this.flags[row.key];
      }
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines: string[] = [];

    lines.push(overlayTitleLine("Experimental features", boxWidth));
    lines.push(overlayEmptyLine(boxWidth));
    overlayPushWrapped(
      lines,
      "These features may break sessions. Enable only for testing.",
      innerWidth,
      boxWidth
    );
    lines.push(overlayEmptyLine(boxWidth));

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const checked = this.flags[row.key] ? "[x]" : "[ ]";
      const selected = i === this.selectedIndex;
      const label = `${checked} ${row.label}`;
      const inner = selected
        ? `  ${overlayAnsi.fg(39, ">")} ${label}`
        : `    ${overlayMuted(label)}`;
      const hint = `     ${overlayMuted(row.hint)}`;
      lines.push(
        selected
          ? padSelectedSideLine(inner, innerWidth, boxWidth)
          : overlaySideLine(inner, innerWidth, boxWidth)
      );
      lines.push(overlaySideLine(hint, innerWidth, boxWidth));
    }

    lines.push(overlayEmptyLine(boxWidth));
    overlayPushWrapped(
      lines,
      "Space: toggle   Enter: save   Esc: cancel",
      innerWidth,
      boxWidth
    );
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}

function padSelectedSideLine(
  inner: string,
  innerWidth: number,
  boxWidth: number
): string {
  const plainLen = visibleWidth(inner.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ""));
  const pad = Math.max(0, innerWidth - plainLen);
  const body = overlayAnsi.bg(
    OVERLAY_SELECT_BG,
    overlayAnsi.fg(OVERLAY_SELECT_FG, `${inner}${" ".repeat(pad)}`)
  );
  return overlaySideLine(body, innerWidth, boxWidth);
}
