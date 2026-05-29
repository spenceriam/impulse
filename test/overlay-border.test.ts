import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { HelpOverlay } from "../src/cli/components/help-overlay.js";
import { PermissionOverlay } from "../src/cli/components/permission-overlay.js";
import {
  overlayBorderLine,
  overlayEmptyLine,
  overlaySideLine,
  overlayTitleLine,
} from "../src/cli/components/overlay-theme.js";
import type { PermissionRequest } from "../src/permission/index.js";

function lineWidth(line: string): number {
  return visibleWidth(line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ""));
}

describe("overlay border width", () => {
  test("chrome lines are exactly boxWidth columns", () => {
    const boxWidth = 72;
    const lines = [
      overlayTitleLine("Help", boxWidth),
      overlayEmptyLine(boxWidth),
      overlaySideLine("sample content", boxWidth - 4, boxWidth),
      overlayBorderLine(`└${"─".repeat(boxWidth - 2)}┘`, boxWidth),
    ];
    for (const line of lines) {
      expect(lineWidth(line)).toBe(boxWidth);
    }
  });

  test("side line truncates overflow instead of exceeding boxWidth", () => {
    const boxWidth = 40;
    const long = "x".repeat(200);
    const line = overlaySideLine(long, boxWidth - 4, boxWidth);
    expect(lineWidth(line)).toBe(boxWidth);
    expect(line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").includes("│")).toBe(true);
  });

  test("HelpOverlay every render line matches host width", () => {
    const hostWidth = 88;
    const overlay = new HelpOverlay({
      opts: {
        reasoningLevelsLabel: "off | low | high",
        experimentalAdvisor: false,
      },
      maxHeight: 40,
    });
    overlay.setMeasureTerminalWidth(120);
    const rendered = overlay.render(hostWidth);
    expect(rendered.length).toBeGreaterThan(5);
    for (const line of rendered) {
      expect(lineWidth(line)).toBe(hostWidth);
    }
  });

  test("PermissionOverlay every render line matches host width", () => {
    const hostWidth = 64;
    const req: PermissionRequest = {
      id: "p1",
      sessionID: "s1",
      permission: "bash",
      patterns: ["echo test"],
      message: "Execute",
      metadata: {
        command: "echo " + "y".repeat(120),
        description: "Why here",
        reason: "Policy",
      },
    };
    const overlay = new PermissionOverlay(req);
    overlay.setMeasureTerminalWidth(120);
    const rendered = overlay.render(hostWidth);
    for (const line of rendered) {
      expect(lineWidth(line)).toBe(hostWidth);
    }
  });
});
