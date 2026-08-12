import { describe, expect, test } from "bun:test";
import { ExecutionHandoffOverlay } from "../src/cli/components/execution-handoff-overlay.js";

function plain(lines: string[]): string {
  return lines.join("\n").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("ExecutionHandoffOverlay", () => {
  test("renders exact choices and defaults to safe preview", () => {
    const overlay = new ExecutionHandoffOverlay({
      request: "Write the feature",
      description: "Project changes are consequential",
    });
    const output = plain(overlay.render(90));
    expect(output).toContain("Preview safely (recommended)");
    expect(output).toContain("Switch to AGENT");
    expect(output).toContain("Stay in ASK");
    let choice = "";
    overlay.onDecision = (next) => { choice = next; };
    overlay.handleInput("\r");
    expect(choice).toBe("preview");
  });
});
