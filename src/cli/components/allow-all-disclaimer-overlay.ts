import { wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import {
  overlayBottomBorder,
  overlayPushWrapped,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};

export type AllowAllDisclaimerDecision = "agree" | "disagree";

const OPTIONS: Array<{ value: AllowAllDisclaimerDecision; label: string }> = [
  { value: "disagree", label: "I disagree" },
  { value: "agree", label: "I agree" },
];

const BODY_LINES = [
  "/allow-all will bypass all permission requests.",
  "Use this only on a sandbox or trusted system.",
  "impulse is not responsible for any potential damages that may occur.",
];

export class AllowAllDisclaimerOverlay implements Component {
  private selectedIndex = 1;

  onDecision?: (decision: AllowAllDisclaimerDecision) => void;

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\x03") {
      this.onDecision?.("disagree");
      return;
    }

    if (data === "\x1b[D" || data === "\x1b[Z") {
      this.selectedIndex = (this.selectedIndex - 1 + OPTIONS.length) % OPTIONS.length;
      return;
    }

    if (data === "\x1b[C" || data === "\t") {
      this.selectedIndex = (this.selectedIndex + 1) % OPTIONS.length;
      return;
    }

    if (data === "\r") {
      this.onDecision?.(OPTIONS[this.selectedIndex]!.value);
      return;
    }

    const key = data.toLowerCase().trim();
    if (key === "1") this.selectedIndex = 0;
    else if (key === "2") this.selectedIndex = 1;
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(8, boxWidth - 4);
    const lines: string[] = [];

    lines.push(overlayTitleLine("Allow all permissions", boxWidth, 214));

    const pushBoxLine = (content = "") => {
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    pushBoxLine("");
    for (const paragraph of BODY_LINES) {
      overlayPushWrapped(lines, paragraph, innerWidth, boxWidth);
      pushBoxLine("");
    }

    const optionLine = OPTIONS.map((option, index) => {
      const isSelected = index === this.selectedIndex;
      if (isSelected) {
        return `${A.bg(214, A.fg(16, ` ${option.label} `))}`;
      }
      return `${A.fg(250, `[ ${option.label} ]`)}`;
    }).join("   ");

    for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
      pushBoxLine(line);
    }

    pushBoxLine("");
    pushBoxLine(`${A.dim}←/→ choose   Enter confirm   Esc cancel${A.reset}`);
    lines.push(overlayBottomBorder(boxWidth));

    return lines;
  }
}
