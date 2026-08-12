import { type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import {
  overlayBottomBorder,
  overlayEmptyLine,
  overlayPushWrapped,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

export type PreviewReviewDecision = "apply" | "discard" | "keep";

const OPTIONS: Array<{ decision: PreviewReviewDecision; label: string }> = [
  { decision: "apply", label: "Apply" },
  { decision: "discard", label: "Discard" },
  { decision: "keep", label: "Keep preview" },
];

const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  selected: (text: string) => `\x1b[48;5;39m\x1b[38;5;16m ${text} \x1b[0m`,
};

export class PreviewReviewOverlay implements Component {
  private selected = 0;
  onDecision?: (decision: PreviewReviewDecision) => void;

  constructor(private readonly input: {
    changedFiles: string[];
    diffStat: string;
    agentSummary: string[];
  }) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\x03") {
      this.onDecision?.("keep");
      return;
    }
    if (data === "\x1b[D" || data === "\x1b[A" || data === "k") {
      this.selected = (this.selected - 1 + OPTIONS.length) % OPTIONS.length;
      return;
    }
    if (data === "\x1b[C" || data === "\x1b[B" || data === "j" || data === "\t") {
      this.selected = (this.selected + 1) % OPTIONS.length;
      return;
    }
    if (data === "\r") this.onDecision?.(OPTIONS[this.selected]!.decision);
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines = [overlayTitleLine("Safe preview ready", boxWidth), overlayEmptyLine(boxWidth)];
    lines.push(overlaySideLine("PREVIEW · bubblewrap · network off", innerWidth, boxWidth));
    lines.push(overlaySideLine(`${ansi.dim}process cleanup confirmed · workspace kept for review${ansi.reset}`, innerWidth, boxWidth));
    lines.push(overlayEmptyLine(boxWidth));
    overlayPushWrapped(
      lines,
      this.input.changedFiles.length > 0
        ? `Changed: ${this.input.changedFiles.join(", ")}`
        : "Changed: no files",
      innerWidth,
      boxWidth
    );
    if (this.input.diffStat) overlayPushWrapped(lines, this.input.diffStat, innerWidth, boxWidth);
    for (const summary of this.input.agentSummary.slice(0, 3)) {
      overlayPushWrapped(lines, `- ${summary}`, innerWidth, boxWidth);
    }
    lines.push(overlayEmptyLine(boxWidth));
    const choices = OPTIONS.map((option, index) =>
      index === this.selected ? ansi.selected(option.label) : `[ ${option.label} ]`
    ).join("   ");
    overlayPushWrapped(lines, choices, innerWidth, boxWidth);
    lines.push(overlaySideLine(`${ansi.dim}←/→ choose   Enter confirm   Esc keep${ansi.reset}`, innerWidth, boxWidth));
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}
