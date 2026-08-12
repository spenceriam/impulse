import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../src/util/config.js";
import {
  densitySpacing,
  applyOverlayDensity,
  normalizePresentationDensity,
} from "../src/cli/presentation-density.js";
import { ToolBlock } from "../src/cli/components/tool-block.js";

describe("presentation density", () => {
  test("defaults persisted presentation to compact", () => {
    expect(createDefaultConfig().presentationDensity).toBe("compact");
    expect(normalizePresentationDensity(undefined)).toBe("compact");
    expect(normalizePresentationDensity("unknown")).toBe("compact");
  });

  test("keeps semantics stable while comfy adds separation", () => {
    expect(densitySpacing("compact")).toEqual({
      transcriptGap: 0,
      blockGap: 0,
      overlayGap: 0,
    });
    expect(densitySpacing("comfy")).toEqual({
      transcriptGap: 1,
      blockGap: 1,
      overlayGap: 1,
    });
  });

  test("adds body separation to expanded tools only in comfy density", () => {
    const result = {
      success: true,
      output: "Applied edit",
      metadata: {
        type: "file_edit",
        filePath: "src/example.ts",
        compactDiff: ["1 -before", "1 +after"],
        linesAdded: 1,
        linesRemoved: 1,
        replacements: 1,
      },
    };
    const compact = new ToolBlock("file_edit", { path: "src/example.ts" }, {
      presentationDensity: "compact",
    });
    const comfy = new ToolBlock("file_edit", { path: "src/example.ts" }, {
      presentationDensity: "comfy",
    });
    compact.setDone(result, 10);
    comfy.setDone(result, 10);

    expect(compact.render(80)[1]).not.toBe("");
    expect(comfy.render(80)[1]).toBe("");
  });

  test("compact overlays remove empty chrome while comfy preserves it", () => {
    const lines = ["┌─ Title ─┐", "│         │", "│ value   │", "└─────────┘"];
    expect(applyOverlayDensity(lines, "compact")).toEqual([
      "┌─ Title ─┐",
      "│ value   │",
      "└─────────┘",
    ]);
    expect(applyOverlayDensity(lines, "comfy")).toEqual(lines);
  });
});
