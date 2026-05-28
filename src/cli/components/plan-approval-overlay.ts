import { type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import {
  overlayBottomBorder,
  overlayEmptyLine,
  overlayPushWrapped,
  overlayTitleLine,
} from "./overlay-theme.js";

export type PlanApprovalDecision = "proceed" | "decline";

export interface PlanApprovalOverlayInput {
  planPath: string;
  summary: string;
  planMarkdown: string;
}

export class PlanApprovalOverlay implements Component {
  private readonly planPath: string;
  private readonly summary: string;
  private readonly planMarkdown: string;

  onDecision?: (decision: PlanApprovalDecision) => void;

  constructor(input: PlanApprovalOverlayInput) {
    this.planPath = input.planPath;
    this.summary = input.summary;
    this.planMarkdown = input.planMarkdown;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\r") {
      this.onDecision?.("proceed");
      return;
    }
    if (data === "\x1b" || data === "\x03") {
      this.onDecision?.("decline");
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
    overlayPushWrapped(
      lines,
      `Summary: ${this.summary.slice(0, 200)}`,
      innerWidth,
      boxWidth
    );
    lines.push(overlayEmptyLine(boxWidth));

    const excerpt = this.planMarkdown.slice(0, 2000);
    if (excerpt.trim()) {
      overlayPushWrapped(lines, excerpt, innerWidth, boxWidth);
      lines.push(overlayEmptyLine(boxWidth));
    }

    overlayPushWrapped(
      lines,
      "Enter: proceed with plan   Esc: decline",
      innerWidth,
      boxWidth
    );
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}
