/**
 * Shell mode (!) logic — kept separate to limit renderer.ts churn.
 */

import type { ShellRunResult } from "./user-shell.js";
import {
  abortUserShell,
  runUserShellCommand,
  writeToUserShell,
} from "./user-shell.js";
import { TerminalPanel } from "./components/terminal-panel.js";
import { isShellTakeoverChord } from "./shell-shortcuts.js";
import type { LoopEvents } from "../agent/loop.js";

export interface ShellModeDeps {
  terminalPanel: TerminalPanel;
  terminalCols: () => number;
  terminalRows: () => number;
  setBusyStatus: (msg: string, fixed?: string) => void;
  spinStop: () => void;
  requestRender: () => void;
  addStatusLine: (line: string) => void;
  isAgentRunning: () => boolean;
  abortAgentTurn: () => void;
  setShellTakeover: (active: boolean) => void;
  dim: (s: string) => string;
  warn: (s: string) => string;
}

export class ShellModeController {
  shellMode = false;
  shellEscArmed = false;
  shellEscTimer: ReturnType<typeof setTimeout> | null = null;
  shellTakeoverActive = false;
  shellCommandRunning = false;
  lastShellOutput: ShellRunResult | null = null;

  constructor(private deps: ShellModeDeps) {}

  toggleShellMode(): void {
    this.shellMode = !this.shellMode;
    this.shellEscArmed = false;
    if (!this.shellMode) {
      this.deps.terminalPanel.reset();
      this.shellTakeoverActive = false;
      this.deps.setShellTakeover(false);
    } else {
      this.deps.addStatusLine(this.deps.dim("Shell mode — run commands, @ to review output, Esc×2 to exit"));
    }
    this.deps.requestRender();
  }

  exitShellMode(): void {
    if (this.shellCommandRunning) abortUserShell();
    this.shellMode = false;
    this.shellEscArmed = false;
    this.shellTakeoverActive = false;
    this.shellCommandRunning = false;
    this.deps.setShellTakeover(false);
    this.deps.terminalPanel.reset();
    this.deps.requestRender();
  }

  handleEscape(): boolean {
    if (!this.shellMode) return false;
    if (this.deps.isAgentRunning()) return false;

    if (!this.shellEscArmed) {
      this.shellEscArmed = true;
      this.deps.addStatusLine(this.deps.dim("Press Esc again to leave terminal mode"));
      if (this.shellEscTimer) clearTimeout(this.shellEscTimer);
      this.shellEscTimer = setTimeout(() => {
        this.shellEscArmed = false;
      }, 2500);
      this.deps.requestRender();
      return true;
    }
    this.exitShellMode();
    this.deps.addStatusLine(this.deps.dim("Left terminal mode"));
    return true;
  }

  handleAbort(): boolean {
    if (this.shellCommandRunning) {
      abortUserShell();
      this.shellCommandRunning = false;
      this.shellTakeoverActive = false;
      this.deps.setShellTakeover(false);
      this.deps.terminalPanel.setDone(-1, 0);
      this.exitShellMode();
      this.deps.addStatusLine(this.deps.warn("Shell command aborted"));
      this.deps.requestRender();
      return true;
    }
    if (this.shellMode) {
      this.exitShellMode();
      this.deps.addStatusLine(this.deps.dim("Left terminal mode"));
      this.deps.requestRender();
      return true;
    }
    return false;
  }

  tryHandleTakeoverChord(data: string): boolean {
    if (!this.shellMode || !this.shellCommandRunning) return false;
    if (!isShellTakeoverChord(data)) return false;
    this.shellTakeoverActive = true;
    this.deps.setShellTakeover(true);
    this.deps.terminalPanel.setTakeoverActive(true);
    this.deps.requestRender();
    return true;
  }

  forwardTakeoverInput(data: string): boolean {
    if (!this.shellTakeoverActive) return false;
    if (data === "\r") {
      writeToUserShell("\n");
      return true;
    }
    if (data === "\x7f" || data === "\b") {
      writeToUserShell("\b");
      return true;
    }
    if (data.length === 1 && data >= " " && data !== "\x1b") {
      writeToUserShell(data);
      return true;
    }
    return false;
  }

  async handleSubmit(
    input: string,
    runReview: (q: string, events: LoopEvents) => Promise<void>,
    reviewEvents: LoopEvents
  ): Promise<boolean> {
    const trimmed = input.trim();
    if (trimmed === "!") {
      this.toggleShellMode();
      return true;
    }
    if (!this.shellMode) return false;
    if (!trimmed) return true;

    if (trimmed.startsWith("@")) {
      const question = trimmed.slice(1).trim();
      if (!question) {
        this.deps.addStatusLine(this.deps.warn("Usage: @ <question about last command output>"));
        this.deps.requestRender();
        return true;
      }
      if (!this.lastShellOutput) {
        this.deps.addStatusLine(this.deps.warn("No shell output to review yet"));
        this.deps.requestRender();
        return true;
      }
      this.deps.terminalPanel.startReview(question);
      this.deps.setBusyStatus("", "Reviewing output..");
      await runReview(question, reviewEvents);
      this.deps.spinStop();
      this.deps.requestRender();
      return true;
    }

    void this.runShellCommand(trimmed);
    return true;
  }

  private async runShellCommand(command: string): Promise<void> {
    this.deps.terminalPanel.clearReview();
    this.deps.terminalPanel.setRunning(command);
    this.shellCommandRunning = true;
    this.shellTakeoverActive = false;
    this.deps.setShellTakeover(false);
    this.deps.setBusyStatus("shell", "Running command..");
    this.deps.requestRender();

    const interactive = /\bsudo\b/.test(command) || command.includes("ssh");
    if (interactive) {
      this.deps.terminalPanel.setInteractiveHint(true);
    }

    const result = await runUserShellCommand({
      command,
      cols: this.deps.terminalCols(),
      rows: Math.max(8, this.deps.terminalRows() - 12),
      onData: (chunk) => {
        this.deps.terminalPanel.appendOutput(chunk);
        this.deps.requestRender();
      },
      forceInteractive: interactive,
    });

    this.shellCommandRunning = false;
    this.shellTakeoverActive = false;
    this.deps.setShellTakeover(false);
    this.deps.terminalPanel.setInteractiveHint(false);
    this.deps.terminalPanel.setTakeoverActive(false);
    this.deps.terminalPanel.setDone(result.exitCode, result.durationMs);
    this.lastShellOutput = result;
    this.deps.spinStop();
    this.deps.requestRender();
  }
}
