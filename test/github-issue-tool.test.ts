import { describe, expect, test } from "bun:test";
import { Tool, isToolAllowedForMode } from "../src/tools/registry.js";
import "../src/tools/init.js";

describe("github_issue tool", () => {
  test("allowed in PLAN mode as read_only", () => {
    expect(isToolAllowedForMode("github_issue", "PLAN")).toBe(true);
  });

  test("returns gh install message when gh missing", async () => {
    const originalProbe = await import("../src/git/gh-cli.js");
    // If gh is installed in CI, skip strict message test
    const status = originalProbe.probeGhCli(true);
    if (status.installed && status.authenticated) {
      return;
    }

    const result = await Tool.execute("github_issue", { number: 50 });
    expect(result.success).toBe(false);
    if (!status.installed) {
      expect(result.output).toContain("not installed");
    } else {
      expect(result.output).toContain("auth");
    }
    expect(result.output).toContain("github.com");
    expect(result.output).toContain("/issues/50");
  });
});