import { describe, expect, test } from "bun:test";
import {
  SettingsOverlay,
  settingsValuesEqual,
} from "../src/cli/components/settings-overlay.js";

const baseValues = {
  chatDensity: "quiet" as const,
  midTurnSubmit: "redirect" as const,
  showRecap: true,
  thinkingDisplay: "summary" as const,
  reasoningLevel: "medium" as const,
  responsePreference: "concise",
  statsOnExit: false,
  showSubagentThinking: false,
  useSubagentModel: false,
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

  test("Chat feel section shows density and mid-turn submit", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    overlay.setMaxHeight(40);
    const plain = overlay.render(100).map(stripAnsi);
    expect(plain.some((l) => l.includes("Chat feel"))).toBe(true);
    expect(plain.some((l) => l.includes("Chat density"))).toBe(true);
    expect(plain.some((l) => l.includes("Quiet"))).toBe(true);
    expect(plain.some((l) => l.includes("Mid-turn submit"))).toBe(true);
    expect(plain.some((l) => l.includes("Redirect live turn"))).toBe(true);
  });

  test("Space cycles chat density Quiet → Verbose", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    // Chat density is first row
    overlay.handleInput(" ");
    expect(overlay.getValues().chatDensity).toBe("verbose");
    overlay.handleInput(" ");
    expect(overlay.getValues().chatDensity).toBe("quiet");
  });

  test("Space cycles mid-turn submit Redirect → Queue", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    overlay.handleInput("\x1b[B"); // mid-turn submit
    overlay.handleInput(" ");
    expect(overlay.getValues().midTurnSubmit).toBe("queue");
    overlay.handleInput(" ");
    expect(overlay.getValues().midTurnSubmit).toBe("redirect");
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
    expect(lines.map(stripAnsi).some((l) => l.includes("Chat density"))).toBe(
      true
    );
  });

  test("tall viewport shows all rows", () => {
    const overlay = new SettingsOverlay({ values: baseValues });
    overlay.setMaxHeight(40);
    const lines = overlay.render(100);
    const plain = lines.map(stripAnsi);
    expect(plain.some((l) => l.includes("Chat density"))).toBe(true);
    expect(plain.some((l) => l.includes("Thinking display"))).toBe(true);
    expect(plain.some((l) => l.includes("Vision override"))).toBe(true);
    expect(plain.some((l) => l.includes("Esc: cancel"))).toBe(true);
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

  test("detects chat density change", () => {
    expect(
      settingsValuesEqual(base, { ...base, chatDensity: "verbose" })
    ).toBe(false);
  });

  test("detects mid-turn submit change", () => {
    expect(
      settingsValuesEqual(base, { ...base, midTurnSubmit: "queue" })
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

  test("detects bottom bar visual change", () => {
    expect(
      settingsValuesEqual(base, { ...base, bottomBarVisual: "minimal" })
    ).toBe(false);
  });
});
