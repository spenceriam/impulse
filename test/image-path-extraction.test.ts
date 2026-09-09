import { describe, expect, test } from "bun:test";
import { extractImagePathRefs } from "../src/cli/image-paths.js";

describe("extractImagePathRefs multi-path pastes (#133 feedback)", () => {
  test("two tab-separated paths (Explorer copy) → two refs", () => {
    const refs = extractImagePathRefs("C:\\a.png\tC:\\b.png");
    expect(refs.length).toBe(2);
    expect(refs[0]!.path).toBe("C:\\a.png");
    expect(refs[1]!.path).toBe("C:\\b.png");
  });

  test("two space-separated paths → two refs", () => {
    const refs = extractImagePathRefs("C:\\a.png C:\\b.png");
    expect(refs.length).toBe(2);
  });

  test("two newline-separated paths → two refs", () => {
    const refs = extractImagePathRefs("C:\\a.png\nC:\\b.png");
    expect(refs.length).toBe(2);
  });

  test("quoted pair → two refs", () => {
    const refs = extractImagePathRefs('"C:\\a.png" "C:\\b.png"');
    expect(refs.length).toBe(2);
  });

  test("unix-style pair → two refs", () => {
    const refs = extractImagePathRefs("/tmp/a.png /tmp/b.png");
    expect(refs.length).toBe(2);
  });

  test("three paths → three refs", () => {
    const refs = extractImagePathRefs("C:\\a.png C:\\b.png C:\\c.png");
    expect(refs.length).toBe(3);
  });

  test("single path stays a single ref", () => {
    const refs = extractImagePathRefs("C:\\a.png");
    expect(refs.length).toBe(1);
  });

  test("prose containing a path stays a single text context (one ref)", () => {
    const refs = extractImagePathRefs("look at C:\\a.png please");
    expect(refs.length).toBe(1);
  });
});