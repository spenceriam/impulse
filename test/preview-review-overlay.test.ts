import { describe, expect, test } from "bun:test";
import { PreviewReviewOverlay } from "../src/cli/components/preview-review-overlay.js";

function plain(lines: string[]): string {
  return lines.join("\n").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("PreviewReviewOverlay", () => {
  test("shows boundary, network, cleanup and requires explicit Apply/Discard/Keep preview", () => {
    const overlay = new PreviewReviewOverlay({
      changedFiles: ["src/a.ts"],
      diffStat: "1 file changed, 1 insertion(+)",
      agentSummary: ["Added the behavior"],
    });
    const output = plain(overlay.render(100));
    expect(output).toContain("PREVIEW · bubblewrap · network off");
    expect(output).toContain("process cleanup confirmed");
    expect(output).toContain("Apply");
    expect(output).toContain("Discard");
    expect(output).toContain("Keep preview");
  });
});
