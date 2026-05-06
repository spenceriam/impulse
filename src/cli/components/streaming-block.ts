/**
 * StreamingBlock — renders the assistant's streaming response.
 * Handles text tokens and thinking/reasoning tokens separately.
 * Thinking block is shown in dim italic, collapses after turn ends.
 */

import type { Component } from "@mariozechner/pi-tui";
import { wrapTextWithAnsi } from "@mariozechner/pi-tui";

const c = {
  reset:      "\x1b[0m",
  dimItalic:  "\x1b[2m\x1b[3m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};

const clr = {
  thinking:    (s: string) => `${c.dimItalic}${s}${c.reset}`,
  thinkLabel:  (s: string) => c.fg(90, s),
  advisorText: (s: string) => c.fg(35, s),
  advisorLabel:(s: string) => `\x1b[1m\x1b[35m${s}${c.reset}`,
};

export class StreamingBlock implements Component {
  private _currentText = "";
  private _currentThinking = "";
  private _currentAdvisor = "";
  private _thinkingCollapsed = false;
  private _advisorModel = "";
  private _isAdvisorActive = false;

  finalize(): void {
    this._thinkingCollapsed = true;
    this._isAdvisorActive = false;
  }

  reset(): void {
    this._currentText = "";
    this._currentThinking = "";
    this._currentAdvisor = "";
    this._thinkingCollapsed = false;
    this._isAdvisorActive = false;
    this._advisorModel = "";
  }

  appendToken(text: string): void   { this._currentText += text; }
  appendThinking(text: string): void { this._currentThinking += text; }

  startAdvisor(model: string): void {
    this._advisorModel = model;
    this._isAdvisorActive = true;
    this._currentAdvisor = "";
  }

  appendAdvisor(text: string): void { this._currentAdvisor += text; }
  endAdvisor(): void                 { this._isAdvisorActive = false; }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];

    // ── Thinking block ──────────────────────────────────────────────────────
    if (this._currentThinking) {
      if (this._thinkingCollapsed) {
        lines.push(clr.thinkLabel("  Thinking… (hidden)"));
      } else {
        lines.push(clr.thinkLabel("┌─ Thinking ─────────────────────────────"));
        const wrapped = wrapTextWithAnsi(this._currentThinking.trim(), width - 4);
        for (const l of wrapped) lines.push(clr.thinking("│ " + l));
        lines.push(clr.thinkLabel("└────────────────────────────────────────"));
      }
      lines.push("");
    }

    // ── Advisor block ───────────────────────────────────────────────────────
    if (this._currentAdvisor || this._isAdvisorActive) {
      const shortAdvisor = this._advisorModel.split("/").pop() ?? this._advisorModel;
      lines.push(clr.advisorLabel(`┌─ Advisor [${shortAdvisor}] ─────────────────`));
      const content = this._currentAdvisor || "…";
      const wrapped = wrapTextWithAnsi(content.trim(), width - 4);
      for (const l of wrapped) lines.push(clr.advisorText("│ " + l));
      lines.push(clr.advisorLabel("└────────────────────────────────────────"));
      lines.push("");
    }

    // ── Main text ───────────────────────────────────────────────────────────
    if (this._currentText) {
      const wrapped = wrapTextWithAnsi(this._currentText, width - 2);
      for (const l of wrapped) lines.push("  " + l);
    }

    return lines;
  }
}
