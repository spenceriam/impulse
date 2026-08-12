import { describe, expect, test } from "bun:test";
import {
  SettingsOverlay,
  settingsValuesEqual,
} from "../src/cli/components/settings-overlay.js";
import { assertGutterSafeAcrossWidths } from "./helpers/gutter-assertions.js";

const baseValues = {
  presentationDensity: "compact" as const,
  approvalPolicy: "prompt" as const,
  thinkingDisplay: "summary" as const,
  reasoningLevel: "medium" as const,
  responsePreference: "concise",
  statsOnExit: false,
  showSubagentThinking: false,
  useSubagentModel: false,
  workerModel: "openai/gpt-5",
  subagentModel: "ollama/foo",
  visionModelOverride: undefined,
  compactToolOutput: true,
  bottomBarVisual: "full" as const,
};

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function assertFooterNeverClipped(lines: string[], maxHeight: number): void {
  expect(lines.length).toBeLessThanOrEqual(maxHeight);
  const plain = lines.map(stripAnsi);
  expect(plain.some((l) => l.includes("Esc: cancel"))).toBe(true);
  expect(plain.at(-1)?.startsWith("└")).toBe(true);
}

describe("SettingsOverlay render", () => {
  test("footer and border never clipped across maxHeight range", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    for (let h = 8; h <= 40; h++) {
      overlay.setMaxHeight(h);
      const lines = overlay.render(100);
      assertFooterNeverClipped(lines, h);
    }
  });

  test("auto-scrolls to last row on End key", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    overlay.setMaxHeight(14);
    overlay.handleInput("\x1b[F");
    const lines = overlay.render(100);
    assertFooterNeverClipped(lines, 14);
    expect(lines.map(stripAnsi).some((l) => l.includes("Vision override"))).toBe(
      true
    );
  });

  test("Home key shows first row", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    overlay.setMaxHeight(14);
    overlay.handleInput("\x1b[F");
    overlay.handleInput("\x1b[H");
    const lines = overlay.render(100);
    expect(lines.map(stripAnsi).some((l) => l.includes("Thinking display"))).toBe(
      true
    );
  });

  test("tall viewport shows all rows", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    overlay.setMaxHeight(40);
    const lines = overlay.render(100);
    const plain = lines.map(stripAnsi);
    expect(plain.some((l) => l.includes("Thinking display"))).toBe(true);
    expect(plain.some((l) => l.includes("Vision override"))).toBe(true);
    expect(plain.some((l) => l.includes("Approval policy"))).toBe(true);
    expect(plain.some((l) => l.includes("Presentation"))).toBe(true);
    expect(plain.some((l) => l.includes("Execution"))).toBe(true);
    expect(plain.some((l) => l.includes("Agents"))).toBe(true);
    expect(plain.some((l) => l.includes("Model"))).toBe(true);
    expect(plain.some((l) => l.includes("Worker model"))).toBe(true);
    expect(plain.some((l) => l.includes("Status"))).toBe(true);
    expect(plain.some((l) => l.includes("Density") && l.includes("compact"))).toBe(true);
    expect(plain.some((l) => l.includes("Esc: cancel"))).toBe(true);
  });

  test("cycles compact to comfy without changing keyboard save behavior", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    overlay.handleInput(" ");
    expect(overlay.getValues().presentationDensity).toBe("comfy");

    const submitted: string[] = [];
    overlay.onSubmit = (values) => submitted.push(values.presentationDensity);
    overlay.handleInput("\r");
    expect(submitted).toEqual(["comfy"]);
  });

  test("gutter-safe across narrow widths", () => {
    assertGutterSafeAcrossWidths((width) => {
      const overlay = new SettingsOverlay({ values: baseValues });
      overlay.setMaxHeight(20);
      return overlay.render(width);
    });
  });
});

describe("settingsValuesEqual", () => {
  const base = baseValues;

  test("detects identical values", () => {
    expect(settingsValuesEqual(base, { ...base })).toBe(true);
  });

  test("detects thinking display change", () => {
    expect(
      settingsValuesEqual(base, { ...base, thinkingDisplay: "full" })
    ).toBe(false);
  });

  test("treats whitespace-only model id differences as equal", () => {
    expect(
      settingsValuesEqual(
        { ...base, subagentModel: "ollama/foo" },
        { ...base, subagentModel: " ollama/foo " }
      )
    ).toBe(true);
  });

  test("detects subagent model change", () => {
    expect(
      settingsValuesEqual(base, { ...base, subagentModel: "ollama/bar" })
    ).toBe(false);
  });

  test("detects worker model change", () => {
    expect(
      settingsValuesEqual(base, { ...base, workerModel: "openai/gpt-5-mini" })
    ).toBe(false);
  });

  test("detects bottom bar visual change", () => {
    expect(
      settingsValuesEqual(base, { ...base, bottomBarVisual: "minimal" })
    ).toBe(false);
  });

  test("detects approval policy change", () => {
    expect(
      settingsValuesEqual(base, { ...base, approvalPolicy: "allow-all" })
    ).toBe(false);
  });

  test("detects presentation density change", () => {
    expect(
      settingsValuesEqual(base, { ...base, presentationDensity: "comfy" })
    ).toBe(false);
  });
});
