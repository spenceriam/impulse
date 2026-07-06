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

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function renderBarWithAllowAll(
  visual: "full" | "reduced" | "minimal" | "off"
): string {
  const bar = new ContextBarComponent({
    ...BASE_STATE,
    bottomBarVisual: visual,
    allowAllBypass: true,
  });
  return stripAnsi(bar.render(120).join("\n"));
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

describe("context bar allow-all indicator", () => {
  test("full shows Allow-All when bypass is on", () => {
    const text = renderBarWithAllowAll("full");
    expect(text).toContain("Allow-All");
    expect(text).not.toContain(" AA");
  });

  test("reduced shows AA when bypass is on", () => {
    const text = renderBarWithAllowAll("reduced");
    expect(text).toContain("AA");
    expect(text).not.toContain("Allow-All");
  });

  test("minimal shows AA when bypass is on", () => {
    const text = renderBarWithAllowAll("minimal");
    expect(text).toContain("AA");
    expect(text).not.toContain("Allow-All");
  });

  test("off hides AA when bypass is on", () => {
    const bar = new ContextBarComponent({
      ...BASE_STATE,
      bottomBarVisual: "off",
      allowAllBypass: true,
    });
    const lines = bar.render(120);
    const text = stripAnsi(lines.join("\n"));
    expect(lines.length).toBe(1);
    expect(text).not.toContain("AA");
    expect(text).not.toContain("Allow-All");
  });

  test("no allow-all label when bypass is off", () => {
    for (const visual of ["full", "reduced", "minimal", "off"] as const) {
      const text = stripAnsi(renderBar(visual));
      expect(text).not.toContain("Allow-All");
      expect(text).not.toContain(" AA");
    }
  });
});

describe("context bar background job (ba) segment", () => {
  const BG_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  test("idle (isRunning false) shows a static count with no spinner glyph", () => {
    const bar = new ContextBarComponent({
      ...BASE_STATE,
      bottomBarVisual: "full",
      backgroundCount: 2,
      isRunning: false,
    });
    const text = stripAnsi(bar.render(120).join("\n"));
    expect(text).toContain("ba 2");
    for (const glyph of BG_SPINNER) {
      expect(text).not.toContain(glyph);
    }
  });

  test("busy (isRunning true) shows the count with a spinner glyph", () => {
    const bar = new ContextBarComponent({
      ...BASE_STATE,
      bottomBarVisual: "full",
      backgroundCount: 2,
      isRunning: true,
    });
    const text = stripAnsi(bar.render(120).join("\n"));
    expect(text).toContain("ba 2");
    expect(BG_SPINNER.some((glyph) => text.includes(glyph))).toBe(true);
  });

  test("zero background jobs omits the segment entirely", () => {
    const bar = new ContextBarComponent({
      ...BASE_STATE,
      bottomBarVisual: "full",
      backgroundCount: 0,
      isRunning: true,
    });
    const text = stripAnsi(bar.render(120).join("\n"));
    expect(text).not.toContain("ba ");
  });

  test("segment is omitted outside full visual mode", () => {
    const bar = new ContextBarComponent({
      ...BASE_STATE,
      bottomBarVisual: "reduced",
      backgroundCount: 3,
      isRunning: true,
    });
    const text = stripAnsi(bar.render(120).join("\n"));
    expect(text).not.toContain("ba 3");
  });
});
