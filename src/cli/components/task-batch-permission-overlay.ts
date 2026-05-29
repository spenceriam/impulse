import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import type { TaskBatchDecision } from "../../permission/task-batch.js";
import { overlayBoxWidth } from "../layout.js";
import {
  intrinsicFramedBoxWidth,
  measureOverlayTopChromeWidth,
  overlayBottomBorder,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

type Step = "main" | "other";

const MAIN_OPTIONS: Array<{ label: string; decision: TaskBatchDecision }> = [
  { label: "Approve", decision: { action: "approve" } },
  { label: "Deny", decision: { action: "deny" } },
  { label: "Other…", decision: { action: "approve" } }, // advances to submenu
];

const OTHER_OPTIONS: Array<{ label: string; decision: TaskBatchDecision }> = [
  {
    label: "Run up to 8 now, queue the rest",
    decision: { action: "approve" },
  },
  {
    label: "Run only first 8",
    decision: { action: "run_first", count: 8 },
  },
  { label: "Cancel batch", decision: { action: "cancel" } },
];

export class TaskBatchPermissionOverlay implements Component {
  private count: number;
  private selectedIndex = 0;
  private step: Step = "main";
  private measureTerminalWidth: number | null = null;

  onDecision?: (decision: TaskBatchDecision) => void;

  constructor(count: number) {
    this.count = count;
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const cap = overlayBoxWidth(terminal);
    const innerWidth = Math.max(8, cap - 4);
    const plainWidths: number[] = [
      measureOverlayTopChromeWidth("Parallel sub-agents", 33),
      visibleWidth(`Approve running ${this.count} general sub-agents in parallel?`),
    ];

    const options = this.step === "main" ? MAIN_OPTIONS : OTHER_OPTIONS;
    const optionLine = options.map((o) => `[ ${o.label} ]`).join("   ");
    for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
      plainWidths.push(visibleWidth(line));
    }
    plainWidths.push(visibleWidth("←/→ choose   Enter confirm   Esc deny"));

    return Math.min(cap, intrinsicFramedBoxWidth(terminal, "Parallel sub-agents", plainWidths));
  }

  invalidate(): void {}

  private currentOptions(): Array<{ label: string; decision: TaskBatchDecision }> {
    return this.step === "main" ? MAIN_OPTIONS : OTHER_OPTIONS;
  }

  handleInput(data: string): void {
    const options = this.currentOptions();

    if (data === "\x1b" || data === "\x03") {
      this.onDecision?.({ action: "deny" });
      return;
    }

    if (data === "\x1b[D" || data === "\x1b[Z") {
      this.selectedIndex = (this.selectedIndex - 1 + options.length) % options.length;
      return;
    }

    if (data === "\x1b[C" || data === "\t") {
      this.selectedIndex = (this.selectedIndex + 1) % options.length;
      return;
    }

    if (data === "\r") {
      const selected = options[this.selectedIndex]!;
      if (this.step === "main" && selected.label === "Other…") {
        this.step = "other";
        this.selectedIndex = 0;
        return;
      }
      this.onDecision?.(selected.decision);
      return;
    }

    const key = data.toLowerCase().trim();
    const idx = Number.parseInt(key, 10) - 1;
    if (idx >= 0 && idx < options.length) {
      this.selectedIndex = idx;
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(8, boxWidth - 4);
    const lines: string[] = [];

    const pushBoxLine = (content = "") => {
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    lines.push(overlayTitleLine("Parallel sub-agents", boxWidth, 33));

    const headline = A.fg(
      33,
      `Approve running ${this.count} general sub-agent${this.count === 1 ? "" : "s"} in parallel?`
    );
    for (const line of wrapTextWithAnsi(headline, innerWidth)) {
      pushBoxLine(line);
    }

    if (this.step === "other") {
      pushBoxLine("");
      for (const line of wrapTextWithAnsi(
        `${A.dim}Choose how to run this batch:${A.reset}`,
        innerWidth
      )) {
        pushBoxLine(line);
      }
    }

    pushBoxLine("");

    const options = this.currentOptions();
    const optionParts = options.map((opt, i) => {
      const selected = i === this.selectedIndex;
      if (selected) {
        return A.fg(33, `[ ${A.bold}${opt.label}${A.reset} ]`);
      }
      return `${A.dim}[ ${opt.label} ]${A.reset}`;
    });

    for (const line of wrapTextWithAnsi(optionParts.join("   "), innerWidth)) {
      pushBoxLine(line);
    }

    pushBoxLine("");
    pushBoxLine(`${A.dim}←/→ choose   Enter confirm   Esc deny${A.reset}`);
    lines.push(overlayBottomBorder(boxWidth));

    return lines;
  }
}
