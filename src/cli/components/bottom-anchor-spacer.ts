/**
 * BottomAnchorSpacer — pushes content down so the bottom component stays at terminal base.
 *
 * This component renders invisible empty lines at the top of the TUI layout.
 * It calculates how many lines are needed based on terminal height and content height.
 * When content exceeds terminal height, it renders 0 lines (pi-tui's viewport handles scrolling).
 */

import type { Component } from "@mariozechner/pi-tui";
import type { TUI } from "@mariozechner/pi-tui";

export class BottomAnchorSpacer implements Component {
  private tui: TUI;
  private getContentHeight: () => number;

  /**
   * @param tui - TUI instance (for terminal.rows access)
   * @param getContentHeight - Callback returning total content height in lines
   */
  constructor(tui: TUI, getContentHeight: () => number) {
    this.tui = tui;
    this.getContentHeight = getContentHeight;
  }

  render(_width: number): string[] {
    const terminalHeight = this.tui.terminal.rows;
    const contentHeight = this.getContentHeight();
    const emptyLines = Math.max(0, terminalHeight - contentHeight);

    // Return empty strings to push content down
    if (emptyLines <= 0) return [];
    return Array.from({ length: emptyLines }, () => "");
  }

  invalidate(): void {
    // No cached state to invalidate
  }
}
