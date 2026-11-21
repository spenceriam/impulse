import { describe, expect, test } from "bun:test";
import { ConfirmOverlay } from "../src/cli/components/confirm-overlay.js";

function render(overlay: ConfirmOverlay): string {
  return overlay.render(80).join("\n");
}

describe("ConfirmOverlay (#214)", () => {
  test("renders the title, body, and both options", () => {
    const overlay = new ConfirmOverlay(
      "Remove a provider key",
      ["Delete sk-***1f from DeepSeek?", "Models using this provider will be unset."],
      { confirmLabel: "Remove it", cancelLabel: "Keep it" }
    );
    const out = render(overlay);
    expect(out).toContain("Remove a provider key");
    expect(out).toContain("Delete sk-***1f from DeepSeek?");
    expect(out).toContain("Remove it");
    expect(out).toContain("Keep it");
  });

  test("has no free-text option (unlike the question tool)", () => {
    const overlay = new ConfirmOverlay("Remove", ["body"]);
    expect(render(overlay)).not.toContain("Type your own answer");
  });

  test("defaults to the safe choice: Enter cancels", () => {
    const overlay = new ConfirmOverlay("Remove", ["body"]);
    let decision: boolean | null = null;
    overlay.onDecision = (ok) => { decision = ok; };
    overlay.handleInput("\r");
    expect(decision).toBe(false);
  });

  test("arrows move the selection and Enter confirms", () => {
    const overlay = new ConfirmOverlay("Remove", ["body"]);
    let decision: boolean | null = null;
    overlay.onDecision = (ok) => { decision = ok; };
    overlay.handleInput("\x1b[D"); // left
    overlay.handleInput("\r");
    expect(decision).toBe(true);
  });

  test("Esc cancels", () => {
    const overlay = new ConfirmOverlay("Remove", ["body"]);
    let decision: boolean | null = null;
    overlay.onDecision = (ok) => { decision = ok; };
    overlay.handleInput("\x1b");
    expect(decision).toBe(false);
  });
});
