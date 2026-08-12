import { describe, expect, test } from "bun:test";
import {
  MODES,
  MODE_CYCLE,
  displayModeLabel,
  displayModeOptions,
  isDefaultMode,
  normalizeMode,
} from "../src/constants.js";

describe("two-mode authority kernel", () => {
  test("publishes only ASK and AGENT with ASK as the safe default", () => {
    expect(MODES).toEqual(["ASK", "AGENT"]);
    expect(MODE_CYCLE).toEqual(["ASK", "AGENT"]);
    expect(displayModeOptions()).toBe("ASK | AGENT");

    expect(normalizeMode()).toBe("ASK");
    expect(normalizeMode("")).toBe("ASK");
    expect(normalizeMode("unknown-mode")).toBe("ASK");
    expect(isDefaultMode("ASK")).toBe(true);
    expect(displayModeLabel("ASK")).toBe("ASK");
    expect(displayModeLabel("AGENT")).toBe("AGENT");

    for (const legacy of ["AGENT", "WORK", "AUTO"]) {
      expect(normalizeMode(legacy)).toBe("AGENT");
    }
    for (const legacy of ["EXPLORE", "PLAN", "PLANNER", "PLAN-PRD", "DEBUG"]) {
      expect(normalizeMode(legacy)).toBe("ASK");
    }
  });
});
