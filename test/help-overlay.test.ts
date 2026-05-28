import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  HelpOverlay,
  buildHelpContent,
  helpSectionRule,
  wrapIndentedProse,
} from "../src/cli/components/help-overlay.js";
import { renderHelpCommandsTable } from "../src/cli/markdown-table.js";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function lineWidth(line: string): number {
  return visibleWidth(stripAnsi(line));
}

const HELP_OPTS = {
  reasoningLevelsLabel: "off | low | high",
  experimentalAdvisor: false,
};

describe("helpSectionRule", () => {
  test("rule width fits overlay inner width", () => {
    const innerWidth = 80;
    const rule = helpSectionRule(innerWidth);
    expect(lineWidth(rule)).toBeLessThanOrEqual(innerWidth);
    expect(stripAnsi(rule)).toContain("──");
  });
});

describe("wrapIndentedProse", () => {
  test("continuation lines keep indent", () => {
    const long =
      "Toggle vision and choose a vision model (same or different provider)";
    const rows = wrapIndentedProse(long, 42);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.startsWith("  ")).toBe(true);
    }
  });
});

describe("renderHelpCommandsTable", () => {
  test("wide layout includes full description without ellipsis", () => {
    const lines = renderHelpCommandsTable(
      [
        {
          cmd: "/vision",
          hint: "vision",
          helpDetail:
            "Toggle vision and choose a vision model (same or different provider)",
        },
      ],
      100
    );
    const plain = stripAnsi(lines.join("\n"));
    expect(plain).toContain("provider");
    expect(plain).not.toMatch(/\.\.\./);
  });

  test("wraps long description to multiple physical rows", () => {
    const lines = renderHelpCommandsTable(
      [
        {
          cmd: "/vision",
          hint: "x",
          helpDetail:
            "Toggle vision and choose a vision model (same or different provider)",
        },
      ],
      52
    );
    const plain = stripAnsi(lines.join("\n"));
    expect(plain).toContain("provider");
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

describe("buildHelpContent", () => {
  test("includes all section titles", () => {
    const content = buildHelpContent(HELP_OPTS, 88);
    const joined = content.join("\n");
    expect(joined).toContain("About");
    expect(joined).toContain("Commands");
    expect(joined).toContain("Modes (/mode)");
    expect(joined).toContain("Images and vision");
    expect(joined).toContain("Status line");
    expect(joined).toContain("Keyboard");
    expect(joined).not.toContain("  |  ");
  });
});

describe("HelpOverlay", () => {
  test("Esc invokes onCancel", () => {
    let cancelled = false;
    const overlay = new HelpOverlay({ opts: HELP_OPTS, maxHeight: 30 });
    overlay.onCancel = () => {
      cancelled = true;
    };
    overlay.handleInput("\x1b");
    expect(cancelled).toBe(true);
  });

  test("every rendered line matches host width", () => {
    const hostWidth = 92;
    const overlay = new HelpOverlay({ opts: HELP_OPTS, maxHeight: 40 });
    overlay.setMeasureTerminalWidth(120);
    const rendered = overlay.render(hostWidth);
    for (const line of rendered) {
      expect(lineWidth(line)).toBe(hostWidth);
    }
  });

  test("section rules are not terminal-wide", () => {
    const innerWidth = 60;
    const content = buildHelpContent({ reasoningLevelsLabel: "off", experimentalAdvisor: false }, innerWidth);
    const rules = content.filter((l) => /^\s+─+$/.test(stripAnsi(l)));
    for (const rule of rules) {
      expect(lineWidth(rule)).toBeLessThanOrEqual(innerWidth);
    }
  });

  test("scrolled viewport keeps title and bottom border", () => {
    const hostWidth = 100;
    const overlay = new HelpOverlay({ opts: HELP_OPTS, maxHeight: 20 });
    overlay.setMeasureTerminalWidth(120);
    overlay.render(hostWidth);
    overlay.handleInput("\x1b[F");
    const bottom = overlay.render(hostWidth);
    expect(bottom.length).toBe(20);
    const plain = bottom.map(stripAnsi).join("\n");
    expect(plain).toContain("Help");
    expect(plain).toContain("└");
  });

  test("scroll top is clamped", () => {
    const overlay = new HelpOverlay({ opts: HELP_OPTS, maxHeight: 15 });
    overlay.setMeasureTerminalWidth(120);
    overlay.render(100);
    for (let i = 0; i < 200; i++) {
      overlay.handleInput("\x1b[B");
    }
    overlay.handleInput("\x1b[F");
    const afterEnd = overlay.render(100);
    expect(afterEnd.length).toBe(15);
    const plain = afterEnd.map(stripAnsi).join("\n");
    expect(plain).toContain("Keyboard");
  });
});
