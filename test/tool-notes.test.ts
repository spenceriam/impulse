import { describe, expect, test } from "bun:test";
import {
  buildFileReadRangeNote,
  buildGlobPathNote,
  buildGrepPathNote,
  buildTaskThoroughnessNote,
  buildWebFetchDefaultsNote,
  buildWebSearchDefaultsNote,
  FILE_READ_DEFAULT_LIMIT,
  prependToolNote,
  WEB_FETCH_DEFAULT_MAX_CHARS,
  WEB_SEARCH_DEFAULT_MAX_RESULTS,
} from "../src/tools/tool-notes";

describe("prependToolNote", () => {
  test("returns output unchanged when note is null", () => {
    expect(prependToolNote("body", null)).toBe("body");
  });

  test("prepends note with newline", () => {
    expect(prependToolNote("body", "Note: hello.")).toBe("Note: hello.\nbody");
  });
});

describe("buildFileReadRangeNote", () => {
  test("notes missing limit", () => {
    const note = buildFileReadRangeNote({ offset: 10 });
    expect(note).toContain("limit was not provided");
    expect(note).toContain(String(FILE_READ_DEFAULT_LIMIT));
  });

  test("notes missing offset", () => {
    const note = buildFileReadRangeNote({ limit: 50 });
    expect(note).toContain("offset was not provided");
  });

  test("null when both or neither provided", () => {
    expect(buildFileReadRangeNote({})).toBeNull();
    expect(buildFileReadRangeNote({ offset: 0, limit: 100 })).toBeNull();
  });
});

describe("buildGlobPathNote", () => {
  test("notes when path omitted", () => {
    const note = buildGlobPathNote({}, "/home/proj");
    expect(note).toContain("path was not provided");
    expect(note).toContain("/home/proj");
  });

  test("null when path provided", () => {
    expect(buildGlobPathNote({ path: "src" }, "/home/proj")).toBeNull();
  });
});

describe("buildGrepPathNote", () => {
  test("notes when path omitted", () => {
    const note = buildGrepPathNote({}, "/repo");
    expect(note).toContain("path was not provided");
  });
});

describe("buildWebFetchDefaultsNote", () => {
  test("notes both defaults when omitted", () => {
    const note = buildWebFetchDefaultsNote({});
    expect(note).toContain(String(WEB_FETCH_DEFAULT_MAX_CHARS));
    expect(note).toContain("browserFallback");
  });

  test("null when both provided", () => {
    expect(
      buildWebFetchDefaultsNote({ maxChars: 5000, browserFallback: false })
    ).toBeNull();
  });
});

describe("buildWebSearchDefaultsNote", () => {
  test("notes maxResults default", () => {
    const note = buildWebSearchDefaultsNote({});
    expect(note).toContain(String(WEB_SEARCH_DEFAULT_MAX_RESULTS));
  });
});

describe("buildTaskThoroughnessNote", () => {
  test("notes when thoroughness set on general subagent", () => {
    const note = buildTaskThoroughnessNote({
      subagent_type: "general",
      thoroughness: "thorough",
    });
    expect(note).toContain("explore");
    expect(note).toContain("ignored");
  });

  test("null for explore with thoroughness", () => {
    expect(
      buildTaskThoroughnessNote({
        subagent_type: "explore",
        thoroughness: "quick",
      })
    ).toBeNull();
  });
});
