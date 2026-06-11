import { describe, expect, test } from "bun:test";
import { Tool, isToolAllowedForMode } from "../src/tools/registry.js";
import { probeGhCli } from "../src/git/gh-cli.js";
import { GithubIssueSchema } from "../src/tools/github-issue.js";
import "../src/tools/init.js";

const ghReady = probeGhCli(true);

describe("github_issue schema", () => {
  test("accepts plain issue number", () => {
    const parsed = GithubIssueSchema.parse({ number: 123 });
    expect(parsed.number).toBe(123);
  });

  test("accepts URL string in number field", () => {
    const parsed = GithubIssueSchema.parse({
      number: "https://github.com/foo/bar/issues/9",
    });
    expect(parsed.number).toBe(9);
    expect(parsed.owner).toBe("foo");
    expect(parsed.repo).toBe("bar");
    expect(parsed.url).toBe("https://github.com/foo/bar/issues/9");
  });

  test("accepts numeric string in number field", () => {
    const parsed = GithubIssueSchema.parse({ number: "123" });
    expect(parsed.number).toBe(123);
  });

  test("accepts url-only input", () => {
    const parsed = GithubIssueSchema.parse({
      url: "https://github.com/acme/widgets/issues/42",
    });
    expect(parsed.number).toBe(42);
    expect(parsed.url).toBe("https://github.com/acme/widgets/issues/42");
  });

  test("accepts www.github.com URL", () => {
    const parsed = GithubIssueSchema.parse({
      number: "https://www.github.com/foo/bar/issues/7",
    });
    expect(parsed.number).toBe(7);
    expect(parsed.owner).toBe("foo");
    expect(parsed.repo).toBe("bar");
  });

  test("rejects non-issue URL in number field", () => {
    expect(() =>
      GithubIssueSchema.parse({ number: "https://github.com/foo/bar/pull/5" })
    ).toThrow();
  });
});

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
