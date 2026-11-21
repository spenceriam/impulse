import { describe, expect, test } from "bun:test";
import { SelectableListOverlay } from "../src/cli/components/selectable-list-overlay.js";

function keys(overlay: SelectableListOverlay, seq: string[]): void {
  for (const k of seq) overlay.handleInput(k);
}

describe("SelectableListOverlay onRemove (#214)", () => {
  const rows = [
    { id: "a", label: "Provider A" },
    { id: "b", label: "Provider B" },
  ];

  test("d fires onRemove when the search box is empty", () => {
    const overlay = new SelectableListOverlay({ title: "t", rows });
    let fired = 0;
    overlay.onRemove = () => { fired++; };
    overlay.handleInput("d");
    expect(fired).toBe(1);
  });

  test("d types into the filter once a search is active", () => {
    const overlay = new SelectableListOverlay({ title: "t", rows });
    let fired = 0;
    overlay.onRemove = () => { fired++; };
    overlay.handleInput("P");
    overlay.handleInput("d");
    expect(fired).toBe(0);
  });

  test("d does nothing without an onRemove handler", () => {
    const overlay = new SelectableListOverlay({ title: "t", rows });
    expect(() => overlay.handleInput("d")).not.toThrow();
  });

  test("currentRowId follows the cursor", () => {
    const overlay = new SelectableListOverlay({ title: "t", rows });
    expect(overlay.currentRowId()).toBe("a");
    overlay.handleInput("\x1b[B"); // down
    expect(overlay.currentRowId()).toBe("b");
  });
});
