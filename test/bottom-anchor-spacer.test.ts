import { describe, expect, test } from "bun:test";
import { BottomAnchorSpacer } from "../src/cli/components/bottom-anchor-spacer.js";

describe("BottomAnchorSpacer", () => {
  test("uses frozen turn-anchor lines until the active turn releases them", () => {
    let rows = 20;
    let contentHeight = 8;
    let frozen: number | null = null;
    const tui = { terminal: { get rows() { return rows; } } };
    const spacer = new BottomAnchorSpacer(
      tui as never,
      () => contentHeight,
      () => frozen
    );

    expect(spacer.render(80).length).toBe(12);

    frozen = 12;
    contentHeight = 30;
    spacer.invalidate();
    expect(spacer.render(80).length).toBe(12);

    frozen = null;
    spacer.invalidate();
    expect(spacer.render(80).length).toBe(0);

    rows = 40;
    contentHeight = 30;
    spacer.invalidate();
    expect(spacer.render(80).length).toBe(10);
  });
});
