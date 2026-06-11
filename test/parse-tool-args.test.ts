import { describe, expect, test } from "bun:test";
import { parseToolCallArguments, repairToolArgumentsJson } from "../src/tools/parse-tool-args.js";

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
});
