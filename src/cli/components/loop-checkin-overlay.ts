import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import {
  intrinsicFramedBoxWidth,
  measureOverlayTopChromeWidth,
  overlayBottomBorder,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
  overlayAnsi,
} from "./overlay-theme.js";

export type LoopCheckinChoice = "continue" | "finalize" | "stop";

const OPTIONS: Array<{ value: LoopCheckinChoice; label: string }> = [
  { value: "continue", label: "Keep going" },
  { value: "finalize", label: "Wrap up now" },
  { value: "stop", label: "Stop turn" },
];

const A = overlayAnsi;

export class LoopCheckinOverlay implements Component {
  private reason: string;
  private iteration: number;
  private selectedIndex = 0;
  private measureTerminalWidth: number | null = null;

  onDecision?: (choice: LoopCheckinChoice) => void;

  constructor(input: { reason: string; iteration: number }) {
    this.reason = input.reason;
    this.iteration = input.iteration;
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const cap = overlayBoxWidth(terminal);
    const innerWidth = Math.max(8, cap - 4);
    const plainWidths: number[] = [
      measureOverlayTopChromeWidth("Loop check-in", 33),
      visibleWidth(`Impulse appears to be looping (iteration ${this.iteration})`),
      visibleWidth(`Reason: ${this.reason}`),
    ];
    const optionLine = OPTIONS.map((o) => `[ ${o.label} ]`).join("   ");
    for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
      plainWidths.push(visibleWidth(line));
    }
    plainWidths.push(visibleWidth("←/→ choose   Enter confirm   Esc stop turn"));
    return Math.min(cap, intrinsicFramedBoxWidth(terminal, "Loop check-in", plainWidths));
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\x03") {
      this.onDecision?.("stop");
      return;
    }

    if (data === "\x1b[D") {
      this.selectedIndex = (this.selectedIndex - 1 + OPTIONS.length) % OPTIONS.length;
      return;
    }

    if (data === "\x1b[C" || data === "\t") {
      this.selectedIndex = (this.selectedIndex + 1) % OPTIONS.length;
      return;
    }

    if (data === "\r") {
      const choice = OPTIONS[this.selectedIndex]!.value;
      this.onDecision?.(choice);
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(8, boxWidth - 4);

    const lines: string[] = [];
    lines.push(overlayTitleLine("Loop check-in", boxWidth, 33));

    const pushBoxLine = (content = "") => {
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    pushBoxLine(`${A.bold}Impulse appears to be looping (iteration ${this.iteration})${A.reset}`);
    for (const line of wrapTextWithAnsi(`Reason: ${this.reason}`, innerWidth)) {
      pushBoxLine(line);
    }

    pushBoxLine("");

    const optionLine = OPTIONS.map((option, index) => {
      const isSelected = index === this.selectedIndex;
      if (isSelected) {
        return `${A.bg(39, A.fg(16, ` ${option.label} `))}`;
      }
      return `${A.fg(250, `[ ${option.label} ]`)}`;
    }).join("   ");

    for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
      pushBoxLine(line);
    }

    pushBoxLine("");
    pushBoxLine(`${A.dim}←/→ choose   Enter confirm   Esc stop turn${A.reset}`);
    lines.push(overlayBottomBorder(boxWidth));

    return lines;
  }
}
