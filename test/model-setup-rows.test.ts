import { describe, expect, test } from "bun:test";
import {
  buildModelSetupRows,
  buildReasoningSetupRows,
  MANUAL_MODEL_ROW_ID,
} from "../src/cli/model-setup-rows.js";

describe("buildModelSetupRows", () => {
  test("maps model ids to rows", () => {
    const rows = buildModelSetupRows("openai", ["gpt-4", "gpt-4o"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe("gpt-4");
    expect(rows[1]!.id).toBe("gpt-4o");
  });

  test("adds manual row for custom provider when allowed", () => {
    const rows = buildModelSetupRows("my-llm", [], { allowManual: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(MANUAL_MODEL_ROW_ID);
  });
});

describe("buildReasoningSetupRows", () => {
  test("uses display labels", () => {
    const rows = buildReasoningSetupRows(["off", "medium"], (l) =>
      l === "off" ? "Off" : "Medium"
    );
    expect(rows[0]).toEqual({ id: "off", label: "Off" });
    expect(rows[1]).toEqual({ id: "medium", label: "Medium" });
  });
});
