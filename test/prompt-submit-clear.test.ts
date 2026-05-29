import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("prompt submit clear timing", () => {
  test("does not clear prompt in onSubmit finally after runTurn", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/cli/renderer.ts"),
      "utf8"
    );
    expect(src).not.toMatch(
      /void this\.onSubmit\(payload\)\.finally\(\(\) => \{\s*\n\s*this\.promptInput\.clear\(\);/
    );
  });

  test("clears prompt when runTurn accepts the message", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/cli/renderer.ts"),
      "utf8"
    );
    expect(src).toContain("this.promptInput.clear();\n    this.promptHistory.push(displayMessage);");
  });
});
