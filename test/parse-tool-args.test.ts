import { describe, expect, test } from "bun:test";
import {
  formatToolArgParseError,
  parseToolCallArguments,
  repairToolArgumentsJson,
} from "../src/tools/parse-tool-args.js";

describe("parseToolCallArguments", () => {
  test("parses valid JSON unchanged", () => {
    const { args, repaired } = parseToolCallArguments('{"context":"hi","questions":[]}');
    expect(repaired).toBe(false);
    expect(args["context"]).toBe("hi");
  });

  test("repairs missing quote before colon on keys", () => {
    const broken = '{"context: "Foundational decisions", "questions": []}';
    const { args, repaired } = parseToolCallArguments(broken);
    expect(repaired).toBe(true);
    expect(args["context"]).toBe("Foundational decisions");
  });

  test("repairToolArgumentsJson fixes context key", () => {
    expect(repairToolArgumentsJson('{"context: "x"}')).toBe('{"context": "x"}');
  });

  test("reports parseError and falls back to raw when JSON is unsalvageable", () => {
    const hopeless = "{not json at all";
    const { args, repaired, parseError } = parseToolCallArguments(hopeless);
    expect(parseError).toBeDefined();
    expect(repaired).toBe(false);
    expect(args["raw"]).toBe(hopeless);
  });
});

describe("formatToolArgParseError (§2.3 structured arg-parse failures)", () => {
  test("names the tool, surfaces the parse error, and gives a retry instruction", () => {
    const message = formatToolArgParseError(
      "file_read",
      "{not json at all",
      "Unexpected token n in JSON at position 1",
      false
    );
    expect(message).toContain('arguments for "file_read" were not valid JSON');
    expect(message).toContain("Unexpected token n in JSON at position 1");
    expect(message).toContain("Received:");
    expect(message).toContain('matching the "file_read" tool\'s schema');
    expect(message).not.toContain("automatic repair was attempted");
  });

  test("mentions the failed repair attempt when one was tried", () => {
    const message = formatToolArgParseError(
      "question",
      '{"context: "broken beyond the repair pass',
      "Unexpected end of JSON input",
      true
    );
    expect(message).toContain("automatic repair was attempted");
  });

  test("caps the raw JSON preview instead of dumping unbounded input", () => {
    const huge = `{${"x".repeat(1000)}`;
    const message = formatToolArgParseError("bash", huge, "Unexpected end of JSON input", false);
    expect(message.length).toBeLessThan(huge.length);
    expect(message).toContain("…");
  });
});
