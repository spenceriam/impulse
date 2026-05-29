import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  overlayBoxWidth,
  overlayMinWidth,
  gutterWidth,
} from "../src/cli/layout";
import { ContextBarComponent } from "../src/cli/components/context-bar";
import {
  SessionPickerOverlay,
  sessionRowForTest,
  sessionTableCellsForTest,
} from "../src/cli/components/session-picker-overlay";
import {
  SelectableListOverlay,
  rowDisplayLineCount,
} from "../src/cli/components/selectable-list-overlay";
import { overlayChromeLineCount } from "../src/cli/components/overlay-theme";
import { QuestionOverlay } from "../src/cli/components/question-overlay";
import { PermissionOverlay } from "../src/cli/components/permission-overlay";
import type { Session } from "../src/session/store";

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
    expect(overlayBoxWidth(35)).toBe(27);
    expect(overlayBoxWidth(42)).toBe(34);
    expect(overlayBoxWidth(120)).toBe(112);
  });

  test("overlayMinWidth matches content width", () => {
    expect(overlayMinWidth(35)).toBe(27);
    expect(overlayMinWidth(42)).toBe(34);
    expect(overlayMinWidth(120)).toBe(112);
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

describe("SelectableListOverlay height budget", () => {
  const maxHeight = 18;
  const helpLines = ["↑/↓ navigate   Enter resume   Esc cancel"];

  test("render line count stays within maxHeight for many sessions", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `sess_${i}`,
      label: `Session topic ${i}`,
      secondary: `glm-4.7  ·  05/25/2026`,
    }));
    const overlay = new SelectableListOverlay({
      title: "Resume session",
      rows,
      maxHeight,
      helpLines,
    });
    const lines = overlay.render(100);
    expect(lines.length).toBeLessThanOrEqual(maxHeight + 1);
  });

  test("chrome line count matches render structure", () => {
    const overlay = new SelectableListOverlay({
      title: "Resume session",
      rows: [],
      maxHeight,
      helpLines,
    });
    const lines = overlay.render(80);
    const chrome = overlayChromeLineCount(helpLines.length);
    expect(lines.length).toBe(chrome + 1);
  });
});

describe("session picker row labels", () => {
  const baseSession: Session = {
    id: "sess_test",
    name: "Session May 25 at 02:07 PM",
    projectID: "proj",
    directory: "/tmp",
    created_at: "2026-05-25T12:00:00.000Z",
    updated_at: "2026-05-25T14:00:00.000Z",
    messages: [],
    mode: "AGENT",
    model: "",
    todos: [],
    context_window: 200000,
    cost: 0,
    headerTitle: "Line one\n# Heading\nMore text",
  };

  test("sanitizes newlines in header title", () => {
    const row = sessionRowForTest(baseSession);
    expect(row.label).not.toMatch(/\n/);
    expect(row.label).toContain("Line one");
  });

  test("uses em dash for missing model", () => {
    const cells = sessionTableCellsForTest(baseSession);
    expect(cells.model).toContain("—");
    expect(cells.model).not.toContain("unknown");
  });
});

describe("SelectableListOverlay navigation", () => {
  test("arrow down on empty list does not set selectedIndex below zero", () => {
    const overlay = new SelectableListOverlay({
      title: "Empty",
      rows: [],
      loading: false,
      emptyMessage: "  No items",
    });
    overlay.handleInput("\x1b[B");
    const idx = (overlay as { selectedIndex: number }).selectedIndex;
    expect(idx).toBeGreaterThanOrEqual(0);
  });
});

describe("SelectableListOverlay wrapping", () => {
  test("long labels use more than one display line at narrow inner width", () => {
    const row = {
      id: "m1",
      label:
        "DeepSeek/deepseek-v4-pro-reasoning-extra-long-model-name-for-wrap-test",
      secondary: "Ctx: 128k",
    };
    expect(rowDisplayLineCount(row, 40, false)).toBeGreaterThan(1);
  });
});
