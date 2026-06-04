import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearRepoContextCache,
  formatRepoContextPromptBlock,
  issueUrlForNumber,
  parseGitHubOwnerRepo,
  type RepoContext,
} from "../src/git/repo-context.js";

function testContext(owner: string, repo: string): RepoContext {
  const fullName = `${owner}/${repo}`;
  const webUrl = `https://github.com/${fullName}`;
  return {
    owner,
    repo,
    fullName,
    webUrl,
    issueUrlTemplate: `${webUrl}/issues/{number}`,
    source: "package.json",
  };
}

describe("parseGitHubOwnerRepo", () => {
  test("parses https github URL", () => {
    expect(parseGitHubOwnerRepo("https://github.com/spenceriam/impulse")).toEqual({
      owner: "spenceriam",
      repo: "impulse",
    });
  });

  test("parses https with .git suffix", () => {
    expect(parseGitHubOwnerRepo("https://github.com/spenceriam/impulse.git")).toEqual({
      owner: "spenceriam",
      repo: "impulse",
    });
  });

  test("parses git@github.com SSH URL", () => {
    expect(parseGitHubOwnerRepo("git@github.com:spenceriam/impulse.git")).toEqual({
      owner: "spenceriam",
      repo: "impulse",
    });
  });

  test("returns null for non-GitHub host", () => {
    expect(parseGitHubOwnerRepo("https://gitlab.com/foo/bar")).toBeNull();
  });
});

describe("formatRepoContextPromptBlock", () => {
  test("includes owner/repo when context present", () => {
    const block = formatRepoContextPromptBlock(testContext("spenceriam", "impulse"));
    expect(block).toContain("spenceriam/impulse");
    expect(block).toContain("issues/{number}");
  });

  test("mentions question tool when unknown", () => {
    const block = formatRepoContextPromptBlock(null);
    expect(block).toContain("question");
    expect(block).toContain("Type your own answer");
  });
});

describe("issueUrlForNumber", () => {
  test("builds canonical URL", () => {
    expect(issueUrlForNumber(testContext("spenceriam", "impulse"), 50)).toBe(
      "https://github.com/spenceriam/impulse/issues/50"
    );
  });
});

describe("resolveRepoContext cache", () => {
  beforeEach(() => {
    clearRepoContextCache();
  });

  test("clearRepoContextCache does not throw", () => {
    clearRepoContextCache();
    expect(true).toBe(true);
  });
});