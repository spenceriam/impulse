import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  PlanApprovalOverlay,
  type PlanApprovalDecision,
} from "../src/cli/components/plan-approval-overlay.js";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function makeOverlay(): {
  overlay: PlanApprovalOverlay;
  decisions: PlanApprovalDecision[];
} {
  const overlay = new PlanApprovalOverlay({
    summary: "Improve the terminal transcript without mutating the project in ASK.",
    planMarkdown: "1. Inspect current rendering\n2. Preview the changes\n3. Review before apply",
  });
  const decisions: PlanApprovalDecision[] = [];
  overlay.onDecision = (decision) => decisions.push(decision);
  return { overlay, decisions };
}

describe("ASK plan review", () => {
  test("defaults Enter to safe preview and Escape stays in ASK", () => {
    const first = makeOverlay();
    first.overlay.handleInput("\r");
    expect(first.decisions).toEqual(["preview"]);

    const second = makeOverlay();
    second.overlay.handleInput("\x1b");
    expect(second.decisions).toEqual(["stay"]);
  });

  test("offers preview, explicit AGENT switch, revise, and stay", () => {
    const { overlay, decisions } = makeOverlay();
    overlay.handleInput("\x1b[B");
    overlay.handleInput("\r");
    expect(decisions).toEqual(["agent"]);

    const text = overlay.render(80).map(stripAnsi).join("\n");
    expect(text).toContain("ASK · READ-ONLY");
    expect(text).toContain("Preview safely (recommended)");
    expect(text).toContain("Switch to AGENT");
    expect(text).toContain("Revise plan");
    expect(text).toContain("Stay in ASK");
    expect(text).toContain("3 steps");
    expect(text).toContain("not written to project files");
  });

  test.each([60, 80, 120])("fits at %i columns", (width) => {
    const { overlay } = makeOverlay();
    for (const line of overlay.render(width)) {
      expect(visibleWidth(stripAnsi(line))).toBeLessThanOrEqual(width);
    }
  });
});
