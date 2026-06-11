import { describe, expect, test } from "bun:test";
import { Tool, isToolAllowedForMode } from "../src/tools/registry.js";
import { probeGhCli } from "../src/git/gh-cli.js";
import "../src/tools/init.js";

const ghReady = probeGhCli(true);

describe("github_issue tool", () => {
  test("allowed in PLAN mode as read_only", () => {
    expect(isToolAllowedForMode("github_issue", "PLAN")).toBe(true);
  });

  test.skipIf(ghReady.installed && ghReady.authenticated)(
    "returns gh install message when gh missing",
    async () => {
    const status = probeGhCli(true);
    const result = await Tool.execute("github_issue", { number: 50 });
    expect(result.success).toBe(false);
    if (!status.installed) {
      expect(result.output).toContain("not installed");
    } else {
      expect(result.output).toContain("auth");
    }
    expect(result.output).toContain("github.com");
    expect(result.output).toContain("/issues/50");
    }
  );
});