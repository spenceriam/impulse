/**
 * Minimal single-line text input overlay (kitty-protocol-safe).
 *
 * Used for manual entry flows (e.g. custom model id in the model picker)
 * where the setup wizard's prompt-based entry is too heavy.
 */
import type { Component } from "@mariozechner/pi-tui";
import { isBackspace, isEnter, isEscape } from "../keys.js";
import {
  overlayBottomBorder,
  overlayDim,
  overlayPushWrapped,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

export class TextInputOverlay implements Component {
  private value = "";
  private readonly title: string;
  private readonly description: string;
  private readonly placeholder: string;
  private readonly hint: string;

  onSubmit?: (value: string) => void;
  onCancel?: () => void;

  constructor(input: {
    title: string;
    description?: string;
    placeholder?: string;
    hint?: string;
  }) {
    this.title = input.title;
    this.description = input.description ?? "";
    this.placeholder = input.placeholder ?? "";
    this.hint = input.hint ?? "Enter confirm   Esc cancel";
  }

  invalidate(): void {}

  get currentValue(): string {
    return this.value;
  }

  handleInput(data: string): void {
    if (isEscape(data)) {
      this.onCancel?.();
      return;
    }
    if (isEnter(data)) {
      const trimmed = this.value.trim();
      if (trimmed.length > 0) this.onSubmit?.(trimmed);
      return;
    }
    if (isBackspace(data)) {
      this.value = this.value.slice(0, -1);
      return;
    }
    if (data.length === 1 && data >= " " && !data.startsWith("\x1b")) {
      this.value += data;
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines: string[] = [];
    lines.push(overlayTitleLine(this.title, boxWidth));
    const pushBoxLine = (content = "") => {
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    if (this.description) {
      overlayPushWrapped(lines, overlayDim(this.description), innerWidth, boxWidth);
      pushBoxLine();
    }

    const shown = this.value.length > 0 ? this.value : overlayDim(this.placeholder);
    pushBoxLine(`  > ${shown}_`);

    pushBoxLine();
    lines.push(overlaySideLine(overlayDim(this.hint), innerWidth, boxWidth));
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}
