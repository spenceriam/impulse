import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  renderTable,
  renderWideTable,
  slashCommandsToTable,
  tableColumnWidths,
  tableTotalWidth,
} from "../src/cli/markdown-table.js";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("slashCommandsToTable", () => {
  test("maps command defs to Command / Description columns", () => {
    const table = slashCommandsToTable([
      { cmd: "/new", hint: "New session", helpDetail: "Start fresh" },
      { cmd: "/help", hint: "Help", helpDetail: "Show this overlay" },
    ]);
    expect(table.header).toEqual(["Command", "Description"]);
    expect(table.rows[0]).toEqual(["/new", "Start fresh"]);
    expect(table.rows[1]).toEqual(["/help", "Show this overlay"]);
  });
});

describe("renderTable", () => {
  test("uses wide boxed table when width allows", () => {
    const table = slashCommandsToTable([
      { cmd: "/new", hint: "x", helpDetail: "Start" },
      { cmd: "/help", hint: "y", helpDetail: "Help" },
    ]);
    const widths = tableColumnWidths(table);
    const minWide = tableTotalWidth(widths);
    const lines = renderTable(table, minWide);
    expect(lines[0]).toContain("┌");
    expect(lines.some((l) => l.includes("/new"))).toBe(true);
  });

  test("stacked mode wraps long description with label prefix", () => {
    const table = {
      header: ["Command", "Description"],
      rows: [
        [
          "/vision",
          "Toggle vision and choose a vision model (same or different provider)",
        ],
      ],
    };
    const lines = renderTable(table, 40);
    const plain = lines.map(stripAnsi).join("\n");
    expect(plain).toContain("Command");
    expect(plain).toContain("provider");
    expect(plain).toContain("Toggle");
  });
});

describe("renderWideTable", () => {
  test("rows do not exceed computed table width", () => {
    const table = slashCommandsToTable([
      { cmd: "/speedo", hint: "a", helpDetail: "Turn speed display" },
    ]);
    const widths = tableColumnWidths(table);
    const total = tableTotalWidth(widths);
    for (const line of renderWideTable(table, widths)) {
      expect(visibleWidth(stripAnsi(line))).toBeLessThanOrEqual(total);
    }
  });
});
