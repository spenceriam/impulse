/**
 * BottomAnchorSpacer — pushes content down so the bottom component stays at terminal base.
 *
 * This component renders invisible empty lines at the top of the TUI layout.
 * When content exceeds terminal height, it renders 0 lines (pi-tui's viewport handles scrolling).
 */

import type { Component } from "@mariozechner/pi-tui";
import type { TUI } from "@mariozechner/pi-tui";

export class BottomAnchorSpacer implements Component {
  private tui: TUI;
  private getContentHeight: () => number;
  private getAnchorEmptyLines: () => number | null;
  private cachedLines: string[] | null = null;

  /**
   * @param tui - TUI instance (for terminal.rows access)
   * @param getContentHeight - Callback returning total content height in lines
   * @param getAnchorEmptyLines - When set, freeze top padding (e.g. for active turn)
   */
  constructor(
    tui: TUI,
    getContentHeight: () => number,
    getAnchorEmptyLines: () => number | null = () => null
  ) {
    this.tui = tui;
    this.getContentHeight = getContentHeight;
    this.getAnchorEmptyLines = getAnchorEmptyLines;
  }

  render(_width: number): string[] {
    if (this.cachedLines) return this.cachedLines;

    const terminalHeight = this.tui.terminal.rows;
    const frozen = this.getAnchorEmptyLines();
    const emptyLines =
      frozen !== null
        ? frozen
        : Math.max(0, terminalHeight - this.getContentHeight());

    if (emptyLines <= 0) {
      this.cachedLines = [];
      return this.cachedLines;
    }
    this.cachedLines = Array.from({ length: emptyLines }, () => "");
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedLines = null;
  }
}
