import { describe, expect, test } from "bun:test";
import { settingsValuesEqual } from "../src/cli/components/settings-overlay.js";

describe("settingsValuesEqual", () => {
  const base = {
    thinkingDisplay: "summary" as const,
    reasoningLevel: "medium" as const,
    responsePreference: "concise",
    statsOnExit: false,
    showSubagentThinking: false,
    useSubagentModel: false,
    subagentModel: "ollama/foo",
    visionModelOverride: undefined,
    compactToolOutput: true,
  };

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
});
