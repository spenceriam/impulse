import { describe, expect, test } from "bun:test";
import {
  codeBlocksToText,
  describeCodeBlocks,
  extractCodeBlocks,
} from "../src/cli/copy-code.js";

describe("extractCodeBlocks (#130)", () => {
  test("strips fences and keeps bodies in order", () => {
    const blocks = extractCodeBlocks(
      "Here you go:\n\n```bash\ngit status\nbun test\n```\n\nand\n\n```ts\nconst a = 1;\n```\n"
    );
    expect(blocks.map((b) => b.lang)).toEqual(["bash", "ts"]);
    expect(blocks[0]!.lines).toEqual(["git status", "bun test"]);
  });

  test("tilde fences and unlabeled blocks", () => {
    const blocks = extractCodeBlocks("~~~\nplain\n~~~\n```\nx\n```");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lang).toBe("");
    expect(blocks[0]!.lines).toEqual(["plain"]);
  });

  test("unclosed fence runs to the end (streamed reply)", () => {
    const blocks = extractCodeBlocks("```sh\nnpm install");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lines).toEqual(["npm install"]);
  });

  test("removes only the fence's own indentation", () => {
    const blocks = extractCodeBlocks("  ```js\n  if (x) {\n      y();\n  }\n  ```");
    expect(blocks[0]!.lines).toEqual(["if (x) {", "    y();", "}"]);
  });

  test("inline backticks are not fences", () => {
    expect(extractCodeBlocks("Use `npm test` to run")).toEqual([]);
  });
});

describe("codeBlocksToText", () => {
  test("joins blocks with a blank line and drops empty ones", () => {
    const text = codeBlocksToText([
      { lang: "sh", lines: ["a", "b"] },
      { lang: "sh", lines: ["  "] },
      { lang: "ts", lines: ["c"] },
    ]);
    expect(text).toBe("a\nb\n\nc");
  });
});

describe("describeCodeBlocks", () => {
  test("counts usable blocks, lines, and languages", () => {
    expect(
      describeCodeBlocks([
        { lang: "bash", lines: ["git status", "bun test"] },
        { lang: "bash", lines: ["echo hi"] },
      ])
    ).toBe("Copied 2 code blocks (3 lines) · bash");
  });

  test("singular for one block", () => {
    expect(describeCodeBlocks([{ lang: "", lines: ["x"] }])).toBe("Copied 1 code block (1 line)");
  });
});
