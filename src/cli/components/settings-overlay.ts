import { visibleWidth, type Component } from "@mariozechner/pi-tui";
import type { ReasoningLevel, ThinkingDisplay } from "../../util/config.js";
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

const COMM_STYLES = ["concise", "detailed", "casual", "technical"] as const;
const THINKING_CYCLE: ThinkingDisplay[] = ["off", "summary", "full"];
const REASONING_CYCLE: ReasoningLevel[] = ["off", "low", "medium", "high"];

export interface SettingsValues {
  thinkingDisplay: ThinkingDisplay;
  reasoningLevel: ReasoningLevel;
  responsePreference: string;
  statsOnExit: boolean;
  showSubagentThinking: boolean;
  useSubagentModel: boolean;
  subagentModel?: string;
  visionModelOverride?: string;
  compactToolOutput: boolean;
}

export function settingsValuesEqual(a: SettingsValues, b: SettingsValues): boolean {
  return (
    a.thinkingDisplay === b.thinkingDisplay &&
    a.reasoningLevel === b.reasoningLevel &&
    a.responsePreference === b.responsePreference &&
    a.statsOnExit === b.statsOnExit &&
    a.showSubagentThinking === b.showSubagentThinking &&
    a.useSubagentModel === b.useSubagentModel &&
    (a.subagentModel?.trim() ?? "") === (b.subagentModel?.trim() ?? "") &&
    (a.visionModelOverride?.trim() ?? "") === (b.visionModelOverride?.trim() ?? "") &&
    a.compactToolOutput === b.compactToolOutput
  );
}

export interface SettingsOverlayOptions {
  values: SettingsValues;
}

type RowKind = "cycle" | "bool" | "vision" | "subagentModel";

type SettingsRow = {
  key: keyof SettingsValues;
  label: string;
  hint: string;
  kind: RowKind;
};

const SETTINGS_FOOTER =
  "↑/↓ move   Space: cycle/toggle   Enter: save (vision/model: pick)   Esc: cancel";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function cycleValue<T>(current: T, options: readonly T[]): T {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length]!;
}

function formatCycleValue(_label: string, value: string): string {
  return overlayAnsi.fg(39, value);
}

function formatBool(value: boolean): string {
  return value ? overlayAnsi.fg(39, "On") : overlayMuted("Off");
}

function formatSettingRowInner(
  label: string,
  valueText: string,
  selected: boolean,
  innerWidth: number
): string {
  const pointer = selected ? overlayAnsi.fg(39, ">") : " ";
  const labelText = selected ? label : overlayMuted(label);
  const left = ` ${pointer} ${labelText}`;
  const gap = Math.max(
    1,
    innerWidth - visibleWidth(stripAnsi(left)) - visibleWidth(stripAnsi(valueText))
  );
  return `${left}${" ".repeat(gap)}${valueText}`;
}

export class SettingsOverlay implements Component {
  private values: SettingsValues;
  private selectedIndex = 0;
  private measureTerminalWidth: number | null = null;

  private readonly rows: SettingsRow[] = [
    {
      key: "thinkingDisplay",
      label: "Thinking display",
      hint: "off → summary (Thought for…) → full stream",
      kind: "cycle",
    },
    {
      key: "reasoningLevel",
      label: "Reasoning depth",
      hint: "Provider reasoning level for new turns",
      kind: "cycle",
    },
    {
      key: "responsePreference",
      label: "Communication style",
      hint: "concise / detailed / casual / technical",
      kind: "cycle",
    },
    {
      key: "statsOnExit",
      label: "Stats on exit",
      hint: "Full stats on /exit and in /usage when on",
      kind: "bool",
    },
    {
      key: "compactToolOutput",
      label: "Compact tool rows",
      hint: "Dim one-liners for read-only tools; expand to see detail",
      kind: "bool",
    },
    {
      key: "showSubagentThinking",
      label: "Subagent thinking",
      hint: "Show thinking progress inside task tool rows",
      kind: "bool",
    },
    {
      key: "useSubagentModel",
      label: "Subagent model",
      hint: "Use a separate model for task subagents",
      kind: "subagentModel",
    },
    {
      key: "visionModelOverride",
      label: "Vision override",
      hint: "Model for images when main model lacks vision",
      kind: "vision",
    },
  ];

  onPickSubagentModel?: () => void;
  onEnableSubagentModel?: () => void;
  onPickVisionOverride?: () => void;
  onClearVisionOverride?: () => void;
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

  setVisionModelOverride(model: string | undefined): void {
    if (model === undefined) {
      delete this.values.visionModelOverride;
    } else {
      this.values.visionModelOverride = model;
    }
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const widths = this.rows.map((r) =>
      visibleWidth(formatSettingRowInner(r.label, this.displayValue(r), true, 60))
    );
    widths.push(visibleWidth(SETTINGS_FOOTER));
    return intrinsicFramedBoxWidth(terminal, "Settings", widths);
  }

  invalidate(): void {}

  private displayValue(row: SettingsRow): string {
    switch (row.key) {
      case "thinkingDisplay":
        return formatCycleValue(row.label, this.values.thinkingDisplay);
      case "reasoningLevel":
        return formatCycleValue(row.label, this.values.reasoningLevel);
      case "responsePreference":
        return formatCycleValue(row.label, this.values.responsePreference);
      case "statsOnExit":
        return formatBool(this.values.statsOnExit);
      case "compactToolOutput":
        return formatBool(this.values.compactToolOutput);
      case "showSubagentThinking":
        return formatBool(this.values.showSubagentThinking);
      case "useSubagentModel":
        return this.values.useSubagentModel
          ? formatCycleValue(
              row.label,
              this.values.subagentModel?.trim() || "(pick model)"
            )
          : formatBool(false);
      case "visionModelOverride":
        return formatCycleValue(
          row.label,
          this.values.visionModelOverride?.trim() || "(automatic)"
        );
      default:
        return "";
    }
  }

  handleInput(data: string): void {
    if (data === "\x1b") {
      this.onAbort?.();
      return;
    }
    if (data === "\r") {
      const row = this.rows[this.selectedIndex];
      if (!row) {
        this.onSubmit?.({ ...this.values });
        return;
      }
      if (row.key === "useSubagentModel" && this.values.useSubagentModel) {
        this.onPickSubagentModel?.();
        return;
      }
      if (row.key === "visionModelOverride") {
        if (this.values.visionModelOverride?.trim()) {
          this.onClearVisionOverride?.();
        } else {
          this.onPickVisionOverride?.();
        }
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
      this.cycleRow(row);
    }
  }

  private cycleRow(row: SettingsRow): void {
    switch (row.key) {
      case "thinkingDisplay":
        this.values.thinkingDisplay = cycleValue(
          this.values.thinkingDisplay,
          THINKING_CYCLE
        );
        break;
      case "reasoningLevel":
        this.values.reasoningLevel = cycleValue(
          this.values.reasoningLevel,
          REASONING_CYCLE
        );
        break;
      case "responsePreference": {
        const styles = COMM_STYLES as readonly string[];
        const idx = styles.indexOf(this.values.responsePreference);
        const next = styles[(idx + 1) % styles.length] ?? "concise";
        this.values.responsePreference = next;
        break;
      }
      case "statsOnExit":
        this.values.statsOnExit = !this.values.statsOnExit;
        break;
      case "compactToolOutput":
        this.values.compactToolOutput = !this.values.compactToolOutput;
        break;
      case "showSubagentThinking":
        this.values.showSubagentThinking = !this.values.showSubagentThinking;
        break;
      case "useSubagentModel": {
        const wasOff = !this.values.useSubagentModel;
        this.values.useSubagentModel = !this.values.useSubagentModel;
        if (wasOff && this.values.useSubagentModel) {
          this.onEnableSubagentModel?.();
        }
        break;
      }
      case "visionModelOverride":
        if (this.values.visionModelOverride?.trim()) {
          delete this.values.visionModelOverride;
        } else {
          this.onPickVisionOverride?.();
        }
        break;
    }
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
        this.displayValue(row),
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
