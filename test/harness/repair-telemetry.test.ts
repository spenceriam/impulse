import { describe, expect, test } from "bun:test";
import {
  clearRepairTelemetry,
  getRepairTelemetrySummary,
  recordToolInputRepair,
} from "../../src/harness/repair-telemetry.js";

describe("repair telemetry", () => {
  test("aggregates by tool model and repair type", () => {
    clearRepairTelemetry();
    recordToolInputRepair("grep", "ollama/kimi", "null_strip");
    recordToolInputRepair("grep", "ollama/kimi", "null_strip");
    recordToolInputRepair("bash", "openai/gpt-4o", "path_fix");
    const summary = getRepairTelemetrySummary();
    expect(summary).toHaveLength(2);
    expect(summary[0]?.count).toBe(2);
  });
});
