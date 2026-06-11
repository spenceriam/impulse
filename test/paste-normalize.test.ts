import { describe, expect, test } from "bun:test";
import {
  buildSubmitPayload,
  normalizePasteContent,
  userTranscriptText,
} from "../src/cli/prompt-input.js";

describe("paste normalization", () => {
  test("normalizePasteContent converts CRLF and lone CR", () => {
    expect(normalizePasteContent("a\r\nb\rc")).toBe("a\nb\nc");
  });

  test("multi-line paste token counts normalized lines", () => {
    const payload = buildSubmitPayload("[Pasted 3 lines  9 chars #1]", [
      {
        display: "[Pasted 3 lines  9 chars #1]",
        content: "line1\r\nline2\rline3",
        originalDisplay: "[Pasted 3 lines  9 chars #1]",
        kind: "text",
      },
    ]);
    const transcript = userTranscriptText(payload);
    expect(transcript).not.toContain("\r");
    expect(transcript.split("\n").length).toBe(3);
  });
});
