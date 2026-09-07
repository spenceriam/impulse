import { describe, expect, test } from "bun:test";
import { ExecutionHandoffOverlay } from "../src/cli/components/execution-handoff-overlay.js";

function plain(lines: string[]): string {
  return lines.join("\n").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("ExecutionHandoffOverlay", () => {
  test("renders exact choices and defaults to staying in ASK", () => {
    const overlay = new ExecutionHandoffOverlay({
      request: "Write the feature",
      description: "Project changes are consequential",
    });
    const output = plain(overlay.render(90));
    expect(output).toContain("Switch to AGENT");
    expect(output).toContain("Stay in ASK");
    let choice = "";
    overlay.onDecision = (value) => { choice = value; };
    overlay.handleInput("\r");
    expect(choice).toBe("stay");
  });
});
