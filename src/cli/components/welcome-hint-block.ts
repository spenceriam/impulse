/**
 * Welcome keyboard hints — single Component so pi-tui Text does not re-wrap
 * gutter-prefixed lines (which drops the left margin on continuation rows).
 */

import type { Component } from "@mariozechner/pi-tui";
import { renderWelcomeHintLines } from "../welcome-banner.js";

export class WelcomeHintBlock implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    return renderWelcomeHintLines(width);
  }
}
