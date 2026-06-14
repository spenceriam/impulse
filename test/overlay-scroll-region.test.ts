import { describe, expect, test } from "bun:test";
import { composeScrollableOverlay } from "../src/cli/components/overlay-scroll-region.js";

describe("composeScrollableOverlay", () => {
  const top = ["TOP"];
  const body = ["L0", "L1", "L2", "L3", "L4", "L5"];
  const bottom = ["FOOTER", "BORDER"];

  test("returns everything when maxHeight is 0", () => {
    const result = composeScrollableOverlay({
      top,
      body,
      bottom,
      maxHeight: 0,
      scrollTop: 0,
    });
    expect(result.lines).toEqual([...top, ...body, ...bottom]);
    expect(result.needsScroll).toBe(false);
    expect(result.scrollTop).toBe(0);
  });

  test("returns everything when content fits maxHeight", () => {
    const result = composeScrollableOverlay({
      top,
      body,
      bottom,
      maxHeight: 20,
      scrollTop: 0,
    });
    expect(result.lines).toEqual([...top, ...body, ...bottom]);
    expect(result.needsScroll).toBe(false);
  });

  test("pinned chrome always present when clamped", () => {
    const result = composeScrollableOverlay({
      top,
      body,
      bottom,
      maxHeight: 5,
      scrollTop: 0,
    });
    expect(result.lines.length).toBeLessThanOrEqual(5);
    expect(result.lines[0]).toBe("TOP");
    expect(result.lines.at(-2)).toBe("FOOTER");
    expect(result.lines.at(-1)).toBe("BORDER");
    expect(result.needsScroll).toBe(true);
  });

  test("output length equals maxHeight when clamped", () => {
    const result = composeScrollableOverlay({
      top,
      body,
      bottom,
      maxHeight: 6,
      scrollTop: 0,
    });
    expect(result.lines.length).toBe(6);
  });

  test("keepVisible scrolls to show selection near end", () => {
    const result = composeScrollableOverlay({
      top,
      body,
      bottom,
      maxHeight: 5,
      scrollTop: 0,
      keepVisible: { start: 4, length: 2 },
    });
    expect(result.lines).toContain("L4");
    expect(result.lines).toContain("L5");
    expect(result.lines.at(-1)).toBe("BORDER");
  });
});
