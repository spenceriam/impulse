import { type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import {
  overlayBottomBorder,
  overlayEmptyLine,
  overlayPushWrapped,
  overlayTitleLine,
  overlaySideLine,
  overlayAnsi,
  OVERLAY_SELECT_BG,
  OVERLAY_SELECT_FG,
  OVERLAY_MUTED_FG,
} from "./overlay-theme.js";
import type { PlanCompletionDecision } from "../../agent/plan-completion.js";

export type { PlanCompletionDecision } from "../../agent/plan-completion.js";

export interface PlanCompletionOverlayInput {
  planPath: string;
  summary: string;
}

const OPTIONS: Array<{ key: string; label: string; value: PlanCompletionDecision }> = [
  { key: "1", label: "Execute", value: "execute" },
  { key: "2", label: "Proceed", value: "proceed" },
  { key: "3", label: "Revise",  value: "revise"  },
  { key: "4", label: "Cancel",  value: "cancel"  },
];

export class PlanCompletionOverlay implements Component {
  private readonly planPath: string;
  private readonly summary: string;
  private selectedIndex = 0;

  onDecision?: (decision: PlanCompletionDecision) => void;

  constructor(input: PlanCompletionOverlayInput) {
    this.planPath = input.planPath;
    this.summary = input.summary;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\x03" || data === "4" || data.toLowerCase() === "q") {
      this.onDecision?.("cancel");
      return;
    }
    if (data === "1") {
      this.onDecision?.("execute");
      return;
    }
    if (data === "\r") {
      this.onDecision?.(OPTIONS[this.selectedIndex]?.value ?? "proceed");
      return;
    }
    if (data === "2") { this.onDecision?.("proceed"); return; }
    if (data === "3") { this.onDecision?.("revise");  return; }

    // Arrow navigation
    if (data === "\x1b[D" || data === "h") {
      this.selectedIndex = (this.selectedIndex - 1 + OPTIONS.length) % OPTIONS.length;
    }
    if (data === "\x1b[C" || data === "l") {
      this.selectedIndex = (this.selectedIndex + 1) % OPTIONS.length;
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines: string[] = [];

    lines.push(overlayTitleLine("Plan ready", boxWidth));
    lines.push(overlayEmptyLine(boxWidth));
    overlayPushWrapped(lines, `Path: ${this.planPath}`, innerWidth, boxWidth);
    lines.push(overlayEmptyLine(boxWidth));
    if (this.summary.trim()) {
      overlayPushWrapped(lines, `Summary: ${this.summary.slice(0, 200)}`, innerWidth, boxWidth);
      lines.push(overlayEmptyLine(boxWidth));
    }

    // Build option buttons row
    const buttons = OPTIONS.map((opt, i) => {
      const isSelected = i === this.selectedIndex;
      const label = `[${opt.key}] ${opt.label}`;
      if (isSelected) {
        return `\x1b[48;5;${OVERLAY_SELECT_BG}m\x1b[38;5;${OVERLAY_SELECT_FG}m ${label} \x1b[0m`;
      }
      return overlayAnsi.fg(OVERLAY_MUTED_FG, ` ${label} `);
    }).join("  ");

    const hint = overlayAnsi.fg(OVERLAY_MUTED_FG, "← → navigate  Enter select  Esc cancel");
    lines.push(overlaySideLine(buttons, innerWidth, boxWidth));
    lines.push(overlayEmptyLine(boxWidth));
    lines.push(overlaySideLine(hint, innerWidth, boxWidth));
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}
