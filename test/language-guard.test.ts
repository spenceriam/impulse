import { describe, expect, it } from "bun:test";
import { shouldRetryInEnglish } from "../src/ui/language-guard";

describe("shouldRetryInEnglish", () => {
  it("returns false for normal English responses", () => {
    const content = "I will outline the architecture and then list implementation steps in English.";
    expect(shouldRetryInEnglish(content)).toBe(false);
  });

  it("returns true for predominantly Chinese responses", () => {
    const content =
      "我会先分析这个仓库的结构，然后给出一个分阶段的实现计划，最后列出风险和下一步建议。";
    expect(shouldRetryInEnglish(content)).toBe(true);
  });

  it("returns false for mostly English responses with a few Chinese terms", () => {
    const content =
      "We'll compare pi-mono internals, then write a PRD for Homelab-CLI. Keep context around 工具 and 子代理 usage.";
    expect(shouldRetryInEnglish(content)).toBe(false);
  });

  it("ignores code blocks when detecting language", () => {
    const content = [
      "Implementation notes:",
      "```ts",
      "// 中文注释 should not trip the detector inside code",
      "const value = \"hello\";",
      "```",
      "Next, we validate with tests.",
    ].join("\n");
    expect(shouldRetryInEnglish(content)).toBe(false);
  });
});
