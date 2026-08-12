import { type Component } from "@mariozechner/pi-tui";
import type { ExecutionHandoffChoice } from "../../tools/execution-handoff.js";
import { overlayBoxWidth } from "../layout.js";
import {
  overlayBottomBorder,
  overlayEmptyLine,
  overlayPushWrapped,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

const OPTIONS: Array<{ choice: ExecutionHandoffChoice; label: string; description: string }> = [
  {
    choice: "preview",
    label: "Preview safely (recommended)",
    description: "Run in an isolated temporary worktree with network off; review before apply.",
  },
  {
    choice: "agent",
    label: "Switch to AGENT",
    description: "Grant host execution authority for this session.",
  },
  {
    choice: "stay",
    label: "Stay in ASK",
    description: "Keep project read-only and continue the conversation.",
  },
];

const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  selected: (text: string) => `\x1b[48;5;39m\x1b[38;5;16m ${text} \x1b[0m`,
};

export class ExecutionHandoffOverlay implements Component {
  private selected = 0;
  onDecision?: (choice: ExecutionHandoffChoice) => void;

  constructor(private readonly input: { request: string; description: string }) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\x03") {
      this.onDecision?.("stay");
      return;
    }
    if (data === "\x1b[A" || data === "k") {
      this.selected = (this.selected - 1 + OPTIONS.length) % OPTIONS.length;
      return;
    }
    if (data === "\x1b[B" || data === "j" || data === "\t") {
      this.selected = (this.selected + 1) % OPTIONS.length;
      return;
    }
    if (data === "\r") this.onDecision?.(OPTIONS[this.selected]!.choice);
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines = [overlayTitleLine("Execution handoff", boxWidth), overlayEmptyLine(boxWidth)];
    overlayPushWrapped(lines, this.input.request, innerWidth, boxWidth);
    overlayPushWrapped(lines, `${ansi.dim}${this.input.description}${ansi.reset}`, innerWidth, boxWidth);
    lines.push(overlayEmptyLine(boxWidth));
    OPTIONS.forEach((option, index) => {
      const label = index === this.selected ? ansi.selected(option.label) : `  ${option.label}`;
      lines.push(overlaySideLine(label, innerWidth, boxWidth));
      overlayPushWrapped(lines, `${ansi.dim}    ${option.description}${ansi.reset}`, innerWidth, boxWidth);
    });
    lines.push(overlayEmptyLine(boxWidth));
    lines.push(overlaySideLine(`${ansi.dim}↑/↓ choose   Enter confirm   Esc stay${ansi.reset}`, innerWidth, boxWidth));
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}
