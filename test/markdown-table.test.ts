import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  parseTable,
  renderTable,
  resolveTableLayoutMode,
  tableTotalWidth,
  tableColumnWidths,
  type MarkdownTable,
} from "../src/cli/markdown-table.js";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

const findingsTable: MarkdownTable = {
  header: ["Phase", "Check", "Result", "Evidence"],
  rows: [
    ["0", "Folder wipe + recreate", "PASS", "x".repeat(120)],
    ["1", "file_write / file_read / file_edit", "PASS", "greeter.ts created"],
    ["6", "set_header", "PASS", "Header updated to `[impulse] \\| Cap smoke test`"],
  ],
};

describe("markdown table layout", () => {
  test("fits wide tables at 173 cols by shrinking columns instead of stacking", () => {
    const width = 173;
    expect(resolveTableLayoutMode(findingsTable, width)).toBe("wide");

    const widths = tableColumnWidths(findingsTable, width);
    expect(tableTotalWidth(widths)).toBeLessThanOrEqual(width);

    const lines = renderTable(findingsTable, width, "wide");
    for (const line of lines) {
      expect(visibleWidth(stripAnsi(line))).toBeLessThanOrEqual(width);
    }
  });

  test("falls back to stacked layout when columns cannot fit at minimum width", () => {
    // Four columns at TABLE_MIN_COLUMN_WIDTH (8) need 45 cols including borders.
    expect(resolveTableLayoutMode(findingsTable, 30)).toBe("stacked");
  });

  test("preserves escaped pipe inside a table cell", () => {
    const markdown = [
      "| Phase | Check | Result | Evidence |",
      "| --- | --- | --- | --- |",
      "| 6 | set_header | PASS | Header updated to `[impulse] \\| Cap smoke test` |",
    ];
    const parsed = parseTable(markdown, 0);
    expect(parsed).not.toBeNull();
    expect(parsed!.table.rows).toHaveLength(1);
    expect(parsed!.table.rows[0]).toHaveLength(4);
    expect(parsed!.table.rows[0]![3]).toBe(
      "Header updated to `[impulse] | Cap smoke test`"
    );
  });
});
