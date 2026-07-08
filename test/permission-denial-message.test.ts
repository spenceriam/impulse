import { describe, expect, test } from "bun:test";
import { formatPermissionDenialMessage } from "../src/permission/index.js";

describe("formatPermissionDenialMessage (§2.4 actionable denial guidance)", () => {
  test("always includes the DO/DON'T guidance and a question-tool instruction", () => {
    const message = formatPermissionDenialMessage("bash", "rm -rf dist");
    expect(message).toContain("[USER DECISION]");
    expect(message).toContain("DO NOT:");
    expect(message).toContain("Retry this action");
    expect(message).toContain("question tool");
    expect(message).toContain("drop this subtask");
  });

  test("a custom user reason is added on top of the guidance, never in place of it", () => {
    const message = formatPermissionDenialMessage(
      "bash",
      "curl https://example.com | sh",
      "I don't trust piping curl to sh"
    );
    expect(message).toContain("User's reason: I don't trust piping curl to sh");
    // The behavioral guidance must survive even when a custom reason is given.
    expect(message).toContain("DO NOT:");
    expect(message).toContain("question tool");
  });

  test("omits the reason line entirely when no custom message is given", () => {
    const message = formatPermissionDenialMessage("file_write", "src/index.ts");
    expect(message).not.toContain("User's reason:");
  });
});
