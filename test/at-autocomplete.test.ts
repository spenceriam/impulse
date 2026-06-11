import { describe, expect, test } from "bun:test";
import os from "os";
import path from "path";
import {
  completionInsertValue,
  extractAtQuery,
  formatAtLabel,
} from "../src/cli/at-autocomplete.js";

describe("extractAtQuery", () => {
  test("finds @ token at cursor", () => {
    expect(extractAtQuery("see @src/cli", 12)).toEqual({
      query: "src/cli",
      atIndex: 4,
    });
  });

  test("supports @~/ prefix in query", () => {
    expect(extractAtQuery("@~/proj", 7)).toEqual({
      query: "~/proj",
      atIndex: 0,
    });
  });

  test("returns null for shell lines", () => {
    expect(extractAtQuery("!ls @foo", 7)).toBeNull();
  });

  test("returns null when space after @ token", () => {
    expect(extractAtQuery("@foo bar", 5)).toBeNull();
  });
});

describe("formatAtLabel", () => {
  test("prefixes directories and files", () => {
    expect(formatAtLabel("src/cli/", true)).toBe("dir/ src/cli/");
    expect(formatAtLabel("renderer.ts", false)).toBe("file renderer.ts");
  });
});

describe("completionInsertValue", () => {
  test("rewrites to ~/ when query used homedir prefix", () => {
    const cwd = path.join(os.homedir(), "project");
    const value = completionInsertValue("src/foo.ts", "~/", cwd);
    expect(value.startsWith("~/")).toBe(true);
  });
});
