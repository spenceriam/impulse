import { describe, expect, test } from "bun:test";
import { hasDegeneratePathMarkdown, unwrapDegeneratePath } from "../path-markdown";

describe("path-markdown", () => {
  describe("hasDegeneratePathMarkdown", () => {
    test("rejects empty or very short strings", () => {
      expect(hasDegeneratePathMarkdown("")).toBe(false);
      expect(hasDegeneratePathMarkdown("a")).toBe(false);
      expect(hasDegeneratePathMarkdown("ab")).toBe(false);
    });

    test("rejects simple Windows absolute paths", () => {
      expect(hasDegeneratePathMarkdown("C:\\Users\\test\\file.txt")).toBe(false);
      expect(hasDegeneratePathMarkdown("D:\\workspace\\src\\index.ts")).toBe(false);
      expect(hasDegeneratePathMarkdown("C:/Users/test/file.txt")).toBe(false);
    });

    test("rejects UNC paths", () => {
      expect(hasDegeneratePathMarkdown("\\\\server\\share\\file.txt")).toBe(false);
    });

    test("rejects Unix absolute paths", () => {
      expect(hasDegeneratePathMarkdown("/usr/bin/node")).toBe(false);
      expect(hasDegeneratePathMarkdown("/home/user/file.txt")).toBe(false);
    });

    test("rejects relative paths", () => {
      expect(hasDegeneratePathMarkdown("./src/index.ts")).toBe(false);
      expect(hasDegeneratePathMarkdown("../lib/utils.ts")).toBe(false);
      expect(hasDegeneratePathMarkdown("src/components/App.tsx")).toBe(false);
    });

    test("detects degenerate markdown links", () => {
      expect(hasDegeneratePathMarkdown("[file.ts](file.ts)")).toBe(true);
      expect(hasDegeneratePathMarkdown("prefix[test](test)")).toBe(true);
    });

    test("detects degenerate links with Windows path prefix", () => {
      expect(hasDegeneratePathMarkdown("C:\\workspace\\src\\[file](file)")).toBe(true);
      expect(hasDegeneratePathMarkdown("D:\\projects\\[test](test).ts")).toBe(true);
    });

    test("rejects legitimate markdown links (link text differs from URL)", () => {
      expect(hasDegeneratePathMarkdown("[click here](http://example.com)")).toBe(false);
      expect(hasDegeneratePathMarkdown("[README](./README.md)")).toBe(false);
    });
  });

  describe("unwrapDegeneratePath", () => {
    test("returns null for simple paths", () => {
      expect(unwrapDegeneratePath("C:\\Users\\test\\file.txt")).toBeNull();
      expect(unwrapDegeneratePath("/usr/bin/node")).toBeNull();
      expect(unwrapDegeneratePath("src/index.ts")).toBeNull();
    });

    test("unwraps degenerate links", () => {
      expect(unwrapDegeneratePath("[file.ts](file.ts)")).toBe("file.ts");
      expect(unwrapDegeneratePath("prefix[test](test)")).toBe("prefixtest");
    });

    test("unwraps degenerate links with Windows path prefix", () => {
      expect(unwrapDegeneratePath("C:\\workspace\\src\\[file](file)")).toBe("C:\\workspace\\src\\file");
      expect(unwrapDegeneratePath("D:\\projects\\[test](test).ts")).toBe("D:\\projects\\test.ts");
    });

    test("returns null for legitimate markdown links", () => {
      expect(unwrapDegeneratePath("[click here](http://example.com)")).toBeNull();
      expect(unwrapDegeneratePath("[README](./README.md)")).toBeNull();
    });
  });
});
