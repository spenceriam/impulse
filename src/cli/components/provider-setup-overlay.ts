import { type Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { overlayBoxWidth } from "../layout.js";
import {
  overlayBorderLine,
  overlayDim,
  overlayTitleLine,
  padInnerLine,
} from "./overlay-theme.js";

/**
 * Provider setup in a modal box instead of composer chrome.
 *
 * The composer stays the text-entry surface (secret mode for keys); this
 * overlay owns the presentation: current step, entered values (key masked),
 * discovery status, errors, and nav hints. The key is only accepted after
 * live discovery succeeds with it — the same gate as before.
 */

export class ProviderSetupOverlay implements Component {
  private lines: string[] = [];

  setLines(lines: string[]): void {
    this.lines = lines;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.lines.length === 0) return [];
    const boxWidth = overlayBoxWidth(width);
    const inner = Math.max(20, boxWidth - 4);

    const out = [overlayTitleLine("Provider setup", boxWidth)];
    for (const line of this.lines) {
      if (line === "") {
        out.push(overlayBorderLine("", boxWidth));
        continue;
      }
      const plain = visibleWidth(line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ""));
      const wrapped = plain > inner
        ? line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").slice(0, inner)
        : line;
      out.push(overlayBorderLine(padInnerLine(wrapped, inner), boxWidth));
    }
    out.push(overlayBorderLine(overlayDim("type below · Enter continue · Esc cancel"), boxWidth));
    return out;
  }
}
