import { describe, expect, test } from "bun:test";
import { extractImagePathRefs } from "../src/cli/image-paths";

describe("extractImagePathRefs", () => {
  test("scans inline image paths without throwing (matchAll needs a global regex)", () => {
    // Regression: PATH_WITH_SPACES_RE / PATH_BODY_RE were passed to matchAll
    // without the global flag, which throws a TypeError at runtime.
    let refs: ReturnType<typeof extractImagePathRefs> = [];
    expect(() => {
      refs = extractImagePathRefs("here is an inline image /tmp/a.png to attach");
    }).not.toThrow();
    expect(refs.some((r) => r.path.includes("/tmp/a.png"))).toBe(true);
  });

  test("extracts quoted and inline image paths together", () => {
    const refs = extractImagePathRefs('compare "/tmp/c d.png" and ./e.jpg here');
    const paths = refs.map((r) => r.path);
    expect(paths).toContain("/tmp/c d.png");
    expect(paths).toContain("./e.jpg");
  });

  test("does not throw on text with no image paths", () => {
    expect(extractImagePathRefs("just a plain message")).toEqual([]);
  });
});
