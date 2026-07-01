import { describe, expect, test } from "bun:test";
import {
  PlanCompletionOverlay,
  type PlanCompletionDecision,
} from "../src/cli/components/plan-completion-overlay.js";

function makeOverlay(): { overlay: PlanCompletionOverlay; decisions: PlanCompletionDecision[] } {
  const overlay = new PlanCompletionOverlay({ planPath: ".impulse/plans/x/revisions/y", summary: "" });
  const decisions: PlanCompletionDecision[] = [];
  overlay.onDecision = (d) => decisions.push(d);
  return { overlay, decisions };
}

describe("PlanCompletionOverlay.handleInput", () => {
  test('key "1" always fires execute, regardless of the currently highlighted option', () => {
    const { overlay, decisions } = makeOverlay();
    // Navigate right twice (now highlighting "Revise", index 2) before pressing "1".
    overlay.handleInput("\x1b[C");
    overlay.handleInput("\x1b[C");
    overlay.handleInput("1");
    expect(decisions).toEqual(["execute"]);
  });

  test("Enter fires whichever option is currently highlighted", () => {
    const { overlay, decisions } = makeOverlay();
    overlay.handleInput("\x1b[C"); // -> proceed
    overlay.handleInput("\r");
    expect(decisions).toEqual(["proceed"]);
  });

  test("Enter with no navigation defaults to the first option (execute)", () => {
    const { overlay, decisions } = makeOverlay();
    overlay.handleInput("\r");
    expect(decisions).toEqual(["execute"]);
  });

  test('key "2" always fires proceed', () => {
    const { overlay, decisions } = makeOverlay();
    overlay.handleInput("2");
    expect(decisions).toEqual(["proceed"]);
  });

  test('key "3" always fires revise', () => {
    const { overlay, decisions } = makeOverlay();
    overlay.handleInput("3");
    expect(decisions).toEqual(["revise"]);
  });

  test.each(["4", "\x1b", "\x03", "q", "Q"])("%s cancels", (key) => {
    const { overlay, decisions } = makeOverlay();
    overlay.handleInput(key);
    expect(decisions).toEqual(["cancel"]);
  });

  test("arrow navigation wraps around in both directions", () => {
    const { overlay, decisions } = makeOverlay();
    overlay.handleInput("\x1b[D"); // left from index 0 wraps to index 3 (cancel)
    overlay.handleInput("\r");
    expect(decisions).toEqual(["cancel"]);
  });

  test("render() produces non-empty lines including the plan path and options", () => {
    const overlay = new PlanCompletionOverlay({
      planPath: ".impulse/plans/abc/revisions/2026-01-01",
      summary: "Add feature X",
    });
    const lines = overlay.render(80);
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(joined).toContain(".impulse/plans/abc/revisions/2026-01-01");
    expect(joined).toContain("Add feature X");
  });
});
