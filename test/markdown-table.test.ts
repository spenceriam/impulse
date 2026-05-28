import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { buildSlashCommandDefs } from "../src/cli/slash-commands.js";
import {
  fitTableLineToWidth,
  helpTableColumnWidths,
  mergeTableLinesSideBySide,
  padTableLineToWidth,
  renderHelpCommandsDualColumn,
  renderHelpCommandsTable,
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

const SAMPLE_CMD_DEFS = [
  { cmd: "/allow-all", hint: "a", helpDetail: "Toggle bypassing all tool permission prompts" },
  { cmd: "/clear", hint: "b", helpDetail: "Clear on-screen chat view" },
  { cmd: "/model", hint: "c", helpDetail: "Open model picker overlay" },
  {
    cmd: "/vision",
    hint: "d",
    helpDetail: "Toggle vision and choose a vision model (same or different provider)",
  },
];

describe("renderHelpCommandsDualColumn", () => {
  test("wide layout uses boxed tables not stacked field markers", () => {
    const lines = renderHelpCommandsDualColumn(SAMPLE_CMD_DEFS, 120);
    const plain = stripAnsi(lines.join("\n"));
    expect(plain).toContain("┌");
    expect(plain).toContain("│");
    expect(plain).toContain("/allow-all");
    expect(plain).toContain("/vision");
    expect(plain).not.toContain("[1]");
  });

  test("narrow layout stacks two boxed tables without field markers", () => {
    const lines = renderHelpCommandsDualColumn(SAMPLE_CMD_DEFS, 50);
    const plain = stripAnsi(lines.join("\n"));
    expect(plain).toContain("┌");
    expect(plain).toContain("/allow-all");
    expect(plain).not.toContain("[1]");
  });

  test("mergeTableLinesSideBySide pads each half to halfWidth", () => {
    const merged = mergeTableLinesSideBySide(["left"], ["right"], 10, 2);
    expect(visibleWidth(stripAnsi(merged[0]!))).toBe(22);
    expect(padTableLineToWidth("ab", 5)).toBe("ab   ");
  });

  test("single table wraps long descriptions", () => {
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

  test("helpTableColumnWidths fits table within maxWidth", () => {
    const defs = buildSlashCommandDefs({
      reasoningLevelsLabel: "off | low | high",
      experimentalAdvisor: false,
    });
    const half = 69;
    const [cmdW, descW] = helpTableColumnWidths(defs.slice(0, 5), half);
    expect(tableTotalWidth([cmdW, descW])).toBeLessThanOrEqual(half);
  });

  test("dual merged rows fit width budget and keep right table corners", () => {
    const defs = buildSlashCommandDefs({
      reasoningLevelsLabel: "off | low | high",
      experimentalAdvisor: false,
    });
    const innerWidth = 140;
    const half = Math.floor((innerWidth - 2) / 2);
    const maxMerged = 2 * half + 2;
    const lines = renderHelpCommandsDualColumn(defs, innerWidth);
    const plainLines = lines.map(stripAnsi);

    for (const line of plainLines) {
      expect(line.length).toBeLessThanOrEqual(maxMerged);
    }

    expect((plainLines[0].match(/┐/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const joined = plainLines.join("\n");
    expect((joined.match(/┘/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((joined.match(/└/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const headerRow = plainLines.find((l) => l.includes("Command") && l.includes("Description"));
    expect(headerRow).toBeDefined();
    expect((headerRow!.match(/│/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  test("fitTableLineToWidth truncates overflow", () => {
    const wide = "│" + "x".repeat(80) + "│";
    const fitted = fitTableLineToWidth(wide, 20);
    expect(visibleWidth(stripAnsi(fitted))).toBeLessThanOrEqual(20);
  });
});
