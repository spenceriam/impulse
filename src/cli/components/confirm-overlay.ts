/**
 * Plain CLI confirmation overlay for harness management (#214).
 *
 * The question tool belongs to the agent, not to the harness UI: showing a
 * user "Need your input / Type your own answer" while they remove a provider
 * key mixes agent semantics into a management action. This is the same
 * minimal yes/no shape as the allow-all disclaimer, with no free-text option.
 */

import { wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { isAbortKey, isEnter, isLeft, isRight, isShiftTab, isTab } from "../keys.js";
import { overlayBoxWidth } from "../layout.js";
import {
  overlayBottomBorder,
  overlayPushWrapped,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

const A = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};

export class ConfirmOverlay implements Component {
  private selectedIndex: number;

  onDecision?: (confirmed: boolean) => void;

  constructor(
    private readonly title: string,
    private readonly bodyLines: string[],
    private readonly options: { confirmLabel: string; cancelLabel: string } = {
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
    }
  ) {
    // Default to the safe choice.
    this.selectedIndex = 1;
  }

  private labels(): string[] {
    return [this.options.confirmLabel, this.options.cancelLabel];
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (isAbortKey(data)) {
      this.onDecision?.(false);
      return;
    }
    if (isLeft(data) || isShiftTab(data)) {
      this.selectedIndex = (this.selectedIndex - 1 + 2) % 2;
      return;
    }
    if (isRight(data) || isTab(data)) {
      this.selectedIndex = (this.selectedIndex + 1) % 2;
      return;
    }
    if (isEnter(data)) {
      this.onDecision?.(this.selectedIndex === 0);
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(8, boxWidth - 4);
    const lines: string[] = [];

    lines.push(overlayTitleLine(this.title, boxWidth, 214));
    const pushBoxLine = (content = "") => {
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    pushBoxLine("");
    for (const paragraph of this.bodyLines) {
      overlayPushWrapped(lines, paragraph, innerWidth, boxWidth);
      pushBoxLine("");
    }

    const labels = this.labels();
    const optionLine = labels
      .map((label, index) => {
        if (index === this.selectedIndex) {
          return A.bg(214, A.fg(16, ` ${label} `));
        }
        return A.fg(250, `[ ${label} ]`);
      })
      .join("   ");

    for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
      pushBoxLine(line);
    }

    pushBoxLine("");
    pushBoxLine(`${A.dim}←/→ choose   Enter confirm   Esc cancel${A.reset}`);
    lines.push(overlayBottomBorder(boxWidth));

    return lines;
  }
}
