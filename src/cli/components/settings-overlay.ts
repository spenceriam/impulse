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

export interface SettingsValues {
  showMainThinking: boolean;
  showSubagentThinking: boolean;
  useSubagentModel: boolean;
  subagentModel?: string;
}

/** True when overlay values match what was loaded at open (no toggle edits). */
export function settingsValuesEqual(a: SettingsValues, b: SettingsValues): boolean {
  return (
    a.showMainThinking === b.showMainThinking &&
    a.showSubagentThinking === b.showSubagentThinking &&
    a.useSubagentModel === b.useSubagentModel &&
    (a.subagentModel?.trim() ?? "") === (b.subagentModel?.trim() ?? "")
  );
}

export interface SettingsOverlayOptions {
  values: SettingsValues;
}

type SettingsRowKey =
  | "showMainThinking"
  | "showSubagentThinking"
  | "useSubagentModel";

const SETTINGS_FOOTER =
  "↑/↓ move   Space: True/False   Enter: save (model row: pick)   Esc: cancel";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function formatBool(value: boolean): string {
  return value ? overlayAnsi.fg(39, "True") : overlayMuted("False");
}

function formatSettingRowInner(
  label: string,
  value: boolean,
  selected: boolean,
  innerWidth: number
): string {
  const pointer = selected ? overlayAnsi.fg(39, ">") : " ";
  const labelText = selected ? label : overlayMuted(label);
  const valueText = formatBool(value);
  const left = ` ${pointer} ${labelText}`;
  const gap = Math.max(1, innerWidth - visibleWidth(stripAnsi(left)) - visibleWidth(stripAnsi(valueText)));
  return `${left}${" ".repeat(gap)}${valueText}`;
}

export class SettingsOverlay implements Component {
  private values: SettingsValues;
  private selectedIndex = 0;
  private measureTerminalWidth: number | null = null;

  private readonly rows: Array<{ key: SettingsRowKey; label: string; hint: string }> = [
    {
      key: "showMainThinking",
      label: "Show thinking in main agent",
      hint: "True: stream reasoning, then Thought for…; False: Thinking… then Thought for…",
    },
    {
      key: "showSubagentThinking",
      label: "Show thinking in subagent",
      hint: "True: thinking… under tasks; False: Thinking… then Thought for…",
    },
    {
      key: "useSubagentModel",
      label: "Use different model for subagent",
      hint: "True: task subagents use a separate provider/model",
    },
  ];

  /** User pressed Enter on the subagent model row while enabled. */
  onPickSubagentModel?: () => void;
  /** User set useSubagentModel False → True (open picker). */
  onEnableSubagentModel?: () => void;
  onSubmit?: (values: SettingsValues) => void;
  onAbort?: () => void;

  constructor(opts: SettingsOverlayOptions) {
    this.values = { ...opts.values };
  }

  getValues(): SettingsValues {
    return { ...this.values };
  }

  setSubagentModel(model: string): void {
    this.values.subagentModel = model;
    this.values.useSubagentModel = true;
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const modelLine = this.subagentModelLine();
    const widths = [
      visibleWidth(formatSettingRowInner("Show thinking in main agent", true, true, 60)),
      visibleWidth(this.rows[0]!.hint),
      visibleWidth(modelLine),
      visibleWidth(SETTINGS_FOOTER),
    ];
    return intrinsicFramedBoxWidth(terminal, "Settings", widths);
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b") {
      this.onAbort?.();
      return;
    }
    if (data === "\r") {
      const row = this.rows[this.selectedIndex];
      if (row?.key === "useSubagentModel" && this.values.useSubagentModel) {
        this.onPickSubagentModel?.();
        return;
      }
      this.onSubmit?.({ ...this.values });
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
      if (!row) return;
      const wasFalse = !this.values[row.key];
      this.values[row.key] = !this.values[row.key];
      if (row.key === "useSubagentModel" && wasFalse && this.values.useSubagentModel) {
        this.onEnableSubagentModel?.();
      }
    }
  }

  private subagentModelLine(): string {
    if (!this.values.useSubagentModel) return "";
    const model = this.values.subagentModel?.trim();
    return model
      ? `Subagent model: ${model}`
      : "Subagent model: (not set — Enter to choose)";
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines: string[] = [];

    lines.push(overlayTitleLine("Settings", boxWidth));
    lines.push(overlayEmptyLine(boxWidth));

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const selected = i === this.selectedIndex;
      const inner = formatSettingRowInner(
        row.label,
        this.values[row.key],
        selected,
        innerWidth
      );
      const hint = `     ${overlayMuted(row.hint)}`;
      lines.push(
        selected
          ? padSelectedSideLine(inner, innerWidth, boxWidth)
          : overlaySideLine(inner, innerWidth, boxWidth)
      );
      lines.push(overlaySideLine(hint, innerWidth, boxWidth));

      if (row.key === "useSubagentModel" && this.values.useSubagentModel) {
        const modelInner = `     ${overlayMuted(this.subagentModelLine())}`;
        lines.push(overlaySideLine(modelInner, innerWidth, boxWidth));
      }
    }

    lines.push(overlayEmptyLine(boxWidth));
    overlayPushWrapped(lines, SETTINGS_FOOTER, innerWidth, boxWidth);
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}

function padSelectedSideLine(
  inner: string,
  innerWidth: number,
  boxWidth: number
): string {
  const plainLen = visibleWidth(stripAnsi(inner));
  const pad = Math.max(0, innerWidth - plainLen);
  const body = overlayAnsi.bg(
    OVERLAY_SELECT_BG,
    overlayAnsi.fg(OVERLAY_SELECT_FG, `${inner}${" ".repeat(pad)}`)
  );
  return overlaySideLine(body, innerWidth, boxWidth);
}
