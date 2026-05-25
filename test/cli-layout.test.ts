import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  overlayBoxWidth,
  overlayMinWidth,
  gutterWidth,
} from "../src/cli/layout";
import { ContextBarComponent } from "../src/cli/components/context-bar";
import { SessionPickerOverlay } from "../src/cli/components/session-picker-overlay";
import { QuestionOverlay } from "../src/cli/components/question-overlay";
import { PermissionOverlay } from "../src/cli/components/permission-overlay";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function maxVisibleWidth(lines: string[]): number {
  return Math.max(0, ...lines.map((line) => visibleWidth(stripAnsi(line))));
}

const sampleContextBarState = {
  workerModel: "anthropic/claude-opus-4.7",
  contextTokens: 68000,
  contextWindow: 200000,
  mode: "AGENT",
  reasoningLevel: "thinking",
  cwd: "/Users/spencer/Documents/GitHub/impulse",
  tokensPerSecond: 42,
  lastTurnMs: 3200,
};

describe("overlay layout helpers", () => {
  test("overlayBoxWidth scales down on narrow panes", () => {
    expect(overlayBoxWidth(35)).toBe(31);
    expect(overlayBoxWidth(42)).toBe(38);
    expect(overlayBoxWidth(120)).toBe(74);
  });

  test("overlayMinWidth never exceeds terminal width", () => {
    expect(overlayMinWidth(35)).toBe(31);
    expect(overlayMinWidth(42)).toBe(38);
    expect(overlayMinWidth(120)).toBe(70);
  });

  test("gutterWidth tightens below 50 columns", () => {
    expect(gutterWidth(40)).toBe(2);
    expect(gutterWidth(80)).toBe(4);
  });
});

describe("ContextBarComponent narrow layouts", () => {
  test("uses stacked rows at 42 columns without overflowing", () => {
    const bar = new ContextBarComponent(sampleContextBarState);
    const lines = bar.render(42).filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(maxVisibleWidth(lines)).toBeLessThanOrEqual(42);
  });

  test("fits within width at 100 columns", () => {
    const bar = new ContextBarComponent(sampleContextBarState);
    const lines = bar.render(100).filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(maxVisibleWidth(lines)).toBeLessThanOrEqual(100);
  });

  test("uses ultra-narrow stacking at 58 columns", () => {
    const bar = new ContextBarComponent({
      ...sampleContextBarState,
      mode: "DEBUG",
      advisorModel: "openrouter/anthropic/claude-sonnet-4",
    });
    const lines = bar.render(58).filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(maxVisibleWidth(lines)).toBeLessThanOrEqual(58);
  });
});

describe("ContextBarComponent context metrics", () => {
  test("does not render block progress bar characters", () => {
    const bar = new ContextBarComponent(sampleContextBarState);
    const rendered = bar.render(100).join("\n");
    expect(rendered).not.toContain("█");
    expect(rendered).not.toContain("░");
  });

  test("colors percentage orange in warning zone (50–59%)", () => {
    const bar = new ContextBarComponent({
      ...sampleContextBarState,
      contextTokens: 110_000,
      contextWindow: 200_000,
    });
    const rendered = bar.render(100).join("\n");
    expect(stripAnsi(rendered)).toContain("55%");
    expect(rendered).toContain("\x1b[33m");
    expect(rendered).not.toContain("\x1b[31m");
  });

  test("colors percentage red at auto-compact threshold (60%+)", () => {
    const bar = new ContextBarComponent({
      ...sampleContextBarState,
      contextTokens: 130_000,
      contextWindow: 200_000,
    });
    const rendered = bar.render(100).join("\n");
    expect(stripAnsi(rendered)).toContain("65%");
    expect(rendered).toContain("\x1b[31m");
  });
});

describe("overlay components at narrow width", () => {
  test("session picker box fits within 35 columns", () => {
    const overlay = new SessionPickerOverlay([]);
    const lines = overlay.render(35);
    expect(lines.length).toBeGreaterThan(0);
    expect(maxVisibleWidth(lines)).toBeLessThanOrEqual(35);
  });

  test("question overlay box fits within 35 columns", () => {
    const overlay = new QuestionOverlay({
      context: "Pick one",
      questions: [
        {
          topic: "Mode",
          question: "Which mode?",
          options: [{ label: "WORK", description: "Full execution" }],
        },
      ],
    });
    const lines = overlay.render(35);
    expect(lines.length).toBeGreaterThan(0);
    expect(maxVisibleWidth(lines)).toBeLessThanOrEqual(35);
  });

  test("permission overlay box fits within 35 columns", () => {
    const overlay = new PermissionOverlay({
      id: "perm-1",
      sessionID: "sess-1",
      permission: "bash",
      patterns: ["git status"],
      message: "Run git status",
    });
    const lines = overlay.render(35);
    expect(lines.length).toBeGreaterThan(0);
    expect(maxVisibleWidth(lines)).toBeLessThanOrEqual(35);
  });
});
