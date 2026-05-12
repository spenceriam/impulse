import { describe, expect, test } from "bun:test";
import { createAddedFileCompactDiff, createCompactDiff } from "../src/util/compact-diff";

describe("compact diff", () => {
  test("creates Pi-style line-numbered edit diffs", () => {
    const diff = createCompactDiff(
      "const enabled = true\nValue:100\nexport default config\n",
      "const enabled = true\nValue:999|Modified:true\nexport default config\n",
    );

    expect(diff.additions).toBe(1);
    expect(diff.removals).toBe(1);
    expect(diff.firstChangedLine).toBe(2);
    expect(diff.lines).toEqual([
      " 1 const enabled = true",
      "-2 Value:100",
      "+2 Value:999|Modified:true",
      " 3 export default config",
    ]);
  });

  test("collapses unchanged middle sections", () => {
    const oldContent = ["a", "keep-1", "keep-2", "keep-3", "keep-4", "keep-5", "z"].join("\n");
    const newContent = ["A", "keep-1", "keep-2", "keep-3", "keep-4", "keep-5", "Z"].join("\n");
    const diff = createCompactDiff(oldContent, newContent, { contextLines: 1 });

    expect(diff.lines).toContain("   …");
    expect(diff.lines).toContain("-1 a");
    expect(diff.lines).toContain("+1 A");
    expect(diff.lines).toContain("-7 z");
    expect(diff.lines).toContain("+7 Z");
  });

  test("creates added-file compact previews", () => {
    const diff = createAddedFileCompactDiff("one\ntwo\n");

    expect(diff.additions).toBe(2);
    expect(diff.removals).toBe(0);
    expect(diff.firstChangedLine).toBe(1);
    expect(diff.lines).toEqual(["+1 one", "+2 two"]);
  });
});
