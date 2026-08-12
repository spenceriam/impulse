import { type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import type { Mode } from "../../constants.js";
import {
  applyOverlayDensity,
  type PresentationDensity,
} from "../presentation-density.js";
import {
  overlayAnsi,
  overlayBottomBorder,
  overlayEmptyLine,
  overlayMuted,
  overlayPushWrapped,
  overlaySideLine,
  overlayTitleLine,
  OVERLAY_SELECT_BG,
  OVERLAY_SELECT_FG,
} from "./overlay-theme.js";

export type PlanApprovalDecision = "preview" | "agent" | "revise" | "stay";

export interface PlanApprovalOverlayInput {
  planPath?: string;
  summary: string;
  planMarkdown: string;
  presentationDensity?: PresentationDensity;
  mode?: Mode;
}

const OPTIONS: Array<{
  decision: PlanApprovalDecision;
  label: string;
  description: string;
}> = [
  {
    decision: "preview",
    label: "Preview safely (recommended)",
    description: "Run the plan in an isolated preview; review before any apply.",
  },
  {
    decision: "agent",
    label: "Switch to AGENT",
    description: "Grant explicit host execution authority for this session.",
  },
  {
    decision: "revise",
    label: "Revise plan",
    description: "Keep planning read-only and tell the agent what to change.",
  },
  {
    decision: "stay",
    label: "Stay in ASK",
    description: "Close review without execution or project mutation.",
  },
];

function countPlanSteps(markdown: string): number {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:\d+[.)]|[-*]\s+\[[ xX]\])\s*/.test(line)).length;
}

export class PlanApprovalOverlay implements Component {
  private readonly planPath: string | undefined;
  private readonly summary: string;
  private readonly planMarkdown: string;
  private selected = 0;
  private readonly presentationDensity: PresentationDensity;
  private readonly mode: Mode;

  onDecision?: (decision: PlanApprovalDecision) => void;

  constructor(input: PlanApprovalOverlayInput) {
    this.planPath = input.planPath;
    this.summary = input.summary;
    this.planMarkdown = input.planMarkdown;
    this.presentationDensity = input.presentationDensity ?? "compact";
    this.mode = input.mode ?? "ASK";
  }

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
    if (data === "\r") this.onDecision?.(OPTIONS[this.selected]!.decision);
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const steps = countPlanSteps(this.planMarkdown);
    const lines: string[] = [overlayTitleLine("Plan ready", boxWidth)];

    const authorityLine = this.mode === "ASK"
      ? "ASK · READ-ONLY · conversation plan"
      : "AGENT · PLAN REVIEW · no plan changes applied";
    lines.push(overlaySideLine(overlayMuted(authorityLine), innerWidth, boxWidth));
    lines.push(overlaySideLine(
      overlayMuted(`${steps > 0 ? `${steps} steps · ` : ""}not written to project files`),
      innerWidth,
      boxWidth
    ));
    if (this.planPath) {
      lines.push(overlaySideLine(overlayMuted(`Reference: ${this.planPath}`), innerWidth, boxWidth));
    }
    lines.push(overlayEmptyLine(boxWidth));
    overlayPushWrapped(lines, this.summary.slice(0, 300), innerWidth, boxWidth);

    const excerpt = this.planMarkdown.trim().split(/\r?\n/).slice(0, 8).join("\n");
    if (excerpt) {
      lines.push(overlayEmptyLine(boxWidth));
      overlayPushWrapped(lines, excerpt, innerWidth, boxWidth);
    }

    lines.push(overlayEmptyLine(boxWidth));
    for (let index = 0; index < OPTIONS.length; index += 1) {
      const option = OPTIONS[index]!;
      const optionLabel = this.mode === "AGENT" && option.decision === "agent"
        ? "Continue in AGENT"
        : this.mode === "AGENT" && option.decision === "stay"
          ? "Close review"
          : option.label;
      const label = index === this.selected
        ? `\x1b[48;5;${OVERLAY_SELECT_BG}m\x1b[38;5;${OVERLAY_SELECT_FG}m ${optionLabel} \x1b[0m`
        : `  ${optionLabel}`;
      lines.push(overlaySideLine(label, innerWidth, boxWidth));
      overlayPushWrapped(lines, overlayMuted(`    ${option.description}`), innerWidth, boxWidth);
    }
    lines.push(overlayEmptyLine(boxWidth));
    lines.push(overlaySideLine(
      overlayAnsi.fg(245, "↑/↓ choose   Enter confirm   Esc stay"),
      innerWidth,
      boxWidth
    ));
    lines.push(overlayBottomBorder(boxWidth));
    return applyOverlayDensity(lines, this.presentationDensity);
  }
}
