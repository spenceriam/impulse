import { visibleWidth, type Component } from "@mariozechner/pi-tui";
import type {
  BottomBarVisual,
  ChatDensity,
  MidTurnSubmit,
  ReasoningLevel,
  ThinkingDisplay,
} from "../../util/config.js";
import {
  isDown,
  isEnd,
  isEnter,
  isEscape,
  isHome,
  isSpace,
  isUp,
} from "../keys.js";
import { composeScrollableOverlay } from "./overlay-scroll-region.js";
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

const COMM_STYLES = ["balanced", "concise", "detailed", "casual", "technical"] as const;
const THINKING_CYCLE: ThinkingDisplay[] = ["off", "summary", "full"];
const REASONING_CYCLE: ReasoningLevel[] = ["off", "low", "medium", "high"];
const BOTTOM_BAR_CYCLE: BottomBarVisual[] = ["full", "reduced", "minimal", "off"];
const CHAT_DENSITY_CYCLE: ChatDensity[] = ["quiet", "verbose"];
const MID_TURN_CYCLE: MidTurnSubmit[] = ["redirect", "queue"];

export interface SettingsValues {
  chatDensity: ChatDensity;
  midTurnSubmit: MidTurnSubmit;
  showRecap: boolean;
  thinkingDisplay: ThinkingDisplay;
  reasoningLevel: ReasoningLevel;
  responsePreference: string;
  statsOnExit: boolean;
  showSubagentThinking: boolean;
  useSubagentModel: boolean;
  subagentModel?: string;
  visionModelOverride?: string;
  compactToolOutput: boolean;
  bottomBarVisual: BottomBarVisual;
}

export function settingsValuesEqual(a: SettingsValues, b: SettingsValues): boolean {
  return (
    a.chatDensity === b.chatDensity &&
    a.midTurnSubmit === b.midTurnSubmit &&
    a.showRecap === b.showRecap &&
    a.thinkingDisplay === b.thinkingDisplay &&
    a.reasoningLevel === b.reasoningLevel &&
    a.responsePreference === b.responsePreference &&
    a.statsOnExit === b.statsOnExit &&
    a.showSubagentThinking === b.showSubagentThinking &&
    a.useSubagentModel === b.useSubagentModel &&
    (a.subagentModel?.trim() ?? "") === (b.subagentModel?.trim() ?? "") &&
    (a.visionModelOverride?.trim() ?? "") === (b.visionModelOverride?.trim() ?? "") &&
    a.compactToolOutput === b.compactToolOutput &&
    a.bottomBarVisual === b.bottomBarVisual
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

type SettingsSection = {
  title: string;
  rows: SettingsRow[];
};

const SETTINGS_FOOTER =
  "↑/↓ move   Space: cycle/toggle   Enter: save (vision/model: pick)   Esc: cancel";
const SETTINGS_FOOTER_SCROLL_SUFFIX = "   (more ↑/↓)";

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

function formatMidTurnSubmit(value: MidTurnSubmit): string {
  return value === "redirect" ? "Redirect live turn" : "Queue until free";
}

function formatChatDensity(value: ChatDensity): string {
  return value === "quiet" ? "Quiet" : "Verbose";
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
  private maxHeight = 0;
  private scrollTop = 0;

  private readonly sections: SettingsSection[] = [
    {
      title: "Chat feel",
      rows: [
        {
          key: "chatDensity",
          label: "Chat density",
          hint: "Quiet (default live status) → Verbose (full tool stream)",
          kind: "cycle",
        },
        {
          key: "midTurnSubmit",
          label: "Mid-turn submit",
          hint: "Redirect live turn (steer) → Queue until free",
          kind: "cycle",
        },
        {
          key: "showRecap",
          label: "Recap line",
          hint: "Ghost Recap: after Quiet turns (event-sourced, no extra model call)",
          kind: "bool",
        },
      ],
    },
    {
      title: "Display",
      rows: [
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
          hint: "balanced / concise / detailed / casual / technical",
          kind: "cycle",
        },
        {
          key: "statsOnExit",
          label: "Stats on exit",
          hint: "Full stats on /exit and in /usage when on",
          kind: "bool",
        },
        {
          key: "bottomBarVisual",
          label: "Bottom bar visuals",
          hint: "full → reduced → minimal → off",
          kind: "cycle",
        },
        {
          key: "compactToolOutput",
          label: "Compact tool rows",
          hint: "Dim one-liners for read-only tools; expand to see detail",
          kind: "bool",
        },
      ],
    },
    {
      title: "Agents",
      rows: [
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
      ],
    },
  ];

  private get rows(): SettingsRow[] {
    return this.sections.flatMap((s) => s.rows);
  }

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

  setMaxHeight(lines: number): void {
    this.maxHeight = Math.max(0, lines);
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const widths = this.rows.map((r) =>
      visibleWidth(formatSettingRowInner(r.label, this.displayValue(r), true, 60))
    );
    for (const section of this.sections) {
      widths.push(visibleWidth(section.title) + 4);
    }
    widths.push(
      visibleWidth(SETTINGS_FOOTER + SETTINGS_FOOTER_SCROLL_SUFFIX)
    );
    return intrinsicFramedBoxWidth(terminal, "Settings", widths);
  }

  invalidate(): void {}

  private displayValue(row: SettingsRow): string {
    switch (row.key) {
      case "chatDensity":
        return formatCycleValue(row.label, formatChatDensity(this.values.chatDensity));
      case "midTurnSubmit":
        return formatCycleValue(row.label, formatMidTurnSubmit(this.values.midTurnSubmit));
      case "showRecap":
        return formatBool(this.values.showRecap);
      case "thinkingDisplay":
        return formatCycleValue(row.label, this.values.thinkingDisplay);
      case "reasoningLevel":
        return formatCycleValue(row.label, this.values.reasoningLevel);
      case "responsePreference":
        return formatCycleValue(row.label, this.values.responsePreference);
      case "statsOnExit":
        return formatBool(this.values.statsOnExit);
      case "bottomBarVisual":
        return formatCycleValue(row.label, this.values.bottomBarVisual);
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
    if (isEscape(data)) {
      this.onAbort?.();
      return;
    }
    if (isEnter(data)) {
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
    if (isUp(data) || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (isDown(data) || data === "j") {
      this.selectedIndex = Math.min(this.rows.length - 1, this.selectedIndex + 1);
      return;
    }
    if (isHome(data)) {
      this.selectedIndex = 0;
      return;
    }
    if (isEnd(data)) {
      this.selectedIndex = this.rows.length - 1;
      return;
    }
    if (isSpace(data)) {
      const row = this.rows[this.selectedIndex];
      if (!row) return;
      this.cycleRow(row);
    }
  }

  private cycleRow(row: SettingsRow): void {
    switch (row.key) {
      case "chatDensity":
        this.values.chatDensity = cycleValue(this.values.chatDensity, CHAT_DENSITY_CYCLE);
        break;
      case "midTurnSubmit":
        this.values.midTurnSubmit = cycleValue(this.values.midTurnSubmit, MID_TURN_CYCLE);
        break;
      case "showRecap":
        this.values.showRecap = !this.values.showRecap;
        break;
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
        const next = styles[(idx + 1) % styles.length] ?? "balanced";
        this.values.responsePreference = next;
        break;
      }
      case "statsOnExit":
        this.values.statsOnExit = !this.values.statsOnExit;
        break;
      case "bottomBarVisual":
        this.values.bottomBarVisual = cycleValue(
          this.values.bottomBarVisual,
          BOTTOM_BAR_CYCLE
        );
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

    const top = [
      overlayTitleLine("Settings", boxWidth),
      overlayEmptyLine(boxWidth),
    ];

    const body: string[] = [];
    const rowSpans: { start: number; length: number }[] = [];
    let flatIndex = 0;

    for (let s = 0; s < this.sections.length; s++) {
      const section = this.sections[s]!;
      if (s > 0) {
        body.push(overlayEmptyLine(boxWidth));
      }
      body.push(
        overlaySideLine(overlayMuted(` ${section.title}`), innerWidth, boxWidth)
      );

      for (const row of section.rows) {
        const start = body.length;
        const selected = flatIndex === this.selectedIndex;
        const inner = formatSettingRowInner(
          row.label,
          this.displayValue(row),
          selected,
          innerWidth
        );
        const hint = `     ${overlayMuted(row.hint)}`;
        body.push(
          selected
            ? padSelectedSideLine(inner, innerWidth, boxWidth)
            : overlaySideLine(inner, innerWidth, boxWidth)
        );
        body.push(overlaySideLine(hint, innerWidth, boxWidth));
        rowSpans.push({ start, length: body.length - start });
        flatIndex++;
      }
    }

    const buildBottom = (footerText: string): string[] => {
      const bottom: string[] = [overlayEmptyLine(boxWidth)];
      overlayPushWrapped(bottom, footerText, innerWidth, boxWidth);
      bottom.push(overlayBottomBorder(boxWidth));
      return bottom;
    };

    let bottom = buildBottom(SETTINGS_FOOTER);
    const needsScrollAffordance =
      this.maxHeight > 0 &&
      top.length + body.length + bottom.length > this.maxHeight;
    if (needsScrollAffordance) {
      bottom = buildBottom(SETTINGS_FOOTER + SETTINGS_FOOTER_SCROLL_SUFFIX);
    }

    const keepVisible = rowSpans[this.selectedIndex];
    const result = composeScrollableOverlay({
      top,
      body,
      bottom,
      maxHeight: this.maxHeight,
      scrollTop: this.scrollTop,
      ...(keepVisible !== undefined ? { keepVisible } : {}),
    });
    this.scrollTop = result.scrollTop;
    return result.lines;
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
