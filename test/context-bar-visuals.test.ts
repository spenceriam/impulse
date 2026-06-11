import { describe, expect, test } from "bun:test";
import { ContextBarComponent } from "../src/cli/components/context-bar.js";

const BASE_STATE = {
  workerModel: "ollama/glm-4.7",
  impulseVersion: "1.6.0",
  contextTokens: 34_000,
  contextWindow: 100_000,
  mode: "WORK",
  reasoningLevel: "medium",
  cwd: "/tmp/impulse-test-no-git",
};

function renderBar(visual: "full" | "reduced" | "minimal" | "off"): string {
  const bar = new ContextBarComponent({ ...BASE_STATE, bottomBarVisual: visual });
  return bar.render(120).join("\n");
}

describe("context bar visuals", () => {
  test("off renders a single blank row", () => {
    const bar = new ContextBarComponent({ ...BASE_STATE, bottomBarVisual: "off" });
    const lines = bar.render(120);
    expect(lines.length).toBe(1);
    expect(lines[0]?.trim()).toBe("");
  });

  test("minimal shows model and percentage only", () => {
    const text = renderBar("minimal");
    expect(text).toContain("glm-4.7");
    expect(text).toContain("34%");
    expect(text).not.toContain("/100");
    expect(text).not.toContain("v1.6.0");
    expect(text).not.toContain("impulse-test");
  });

  test("reduced shows model, percentage, directory, and version", () => {
    const text = renderBar("reduced");
    expect(text).toContain("glm-4.7");
    expect(text).toContain("34%");
    expect(text).toContain("impulse-test");
    expect(text).toContain("v1.6.0");
    expect(text).not.toContain("|");
    expect(text).not.toContain("WORK");
  });

  test("full includes mode and date separator", () => {
    const text = renderBar("full");
    expect(text).toContain("WORK");
    expect(text).toContain("v1.6.0 |");
  });
});
