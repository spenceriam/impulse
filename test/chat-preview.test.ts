import { describe, expect, test } from "bun:test";
import {
  ChatExperiencePicker,
  ChatPreviewOverlay,
  frameAt,
  PREVIEW_LOOP_MS,
  previewScript,
} from "../src/cli/components/chat-preview-overlay.js";

describe("preview script (#160)", () => {
  test("quiet and verbose are different renderings of the same turn", () => {
    const quiet = previewScript("quiet");
    const verbose = previewScript("verbose");
    expect(quiet[0]!.body).toBe(verbose[0]!.body); // same prompt
    expect(quiet.at(-1)!.body).not.toBe(verbose.at(-1)!.body);
    expect(verbose.at(-1)!.body).toContain("file_read");
    expect(quiet.at(-1)!.body).toContain("Recap:");
  });

  test("frameAt picks the last frame at or before the time", () => {
    const script = previewScript("quiet");
    expect(frameAt(script, 0)).toBe(script[0]!);
    // 2700ms is still inside the 2500ms frame; 2800ms starts the next one.
    expect(frameAt(script, 2700)).toBe(script[3]!);
    expect(frameAt(script, 2800)).toBe(script[4]!);
  });

  test("frames loop", () => {
    const script = previewScript("quiet");
    expect(frameAt(script, PREVIEW_LOOP_MS)).toBe(script[0]!);
    expect(frameAt(script, PREVIEW_LOOP_MS + 2800)).toBe(script[4]!);
  });
});

describe("ChatPreviewOverlay (#160)", () => {
  test("renders a fixed height so the overlay never jumps", () => {
    const overlay = new ChatPreviewOverlay({ density: "quiet", height: 10 });
    expect(overlay.render(60)).toHaveLength(10);
    overlay.tick(Date.now() + 3000);
    expect(overlay.render(60)).toHaveLength(10);
  });

  test("switching density restarts the loop", () => {
    const overlay = new ChatPreviewOverlay({ density: "quiet" });
    overlay.tick(Date.now() + 4500);
    overlay.setDensity("verbose");
    // Density change restarts the loop at the first frame: prompt only, no
    // tool rows or Recap yet.
    const out = overlay.render(60).join("\n");
    expect(out).toContain("Review what changed this week");
    expect(out).not.toContain("Recap:");
  });

  test("narrow widths do not throw", () => {
    const overlay = new ChatPreviewOverlay({ density: "quiet" });
    expect(() => overlay.render(20)).not.toThrow();
  });
});

describe("ChatExperiencePicker (#160)", () => {
  test("arrows switch the previewed density and Enter confirms it", () => {
    let confirmed: string | null = null;
    const picker = new ChatExperiencePicker({ density: "quiet" });
    picker.onConfirm = (d) => { confirmed = d; };
    picker.handleInput("\x1b[B"); // down
    picker.handleInput("\r");
    expect(confirmed).toBe("verbose");
  });

  test("Esc keeps Quiet", () => {
    let confirmed: string | null = null;
    const picker = new ChatExperiencePicker({ density: "verbose" });
    picker.onConfirm = (d) => { confirmed = d; };
    picker.handleInput("\x1b");
    expect(confirmed).toBe("quiet");
  });

  test("renders both options and never exceeds its width", () => {
    const picker = new ChatExperiencePicker({ density: "quiet", width: 60 });
    const lines = picker.render(60);
    const text = lines.join("\n");
    expect(text).toContain("Quiet");
    expect(text).toContain("Verbose");
    expect(text).toContain("Preview: Quiet");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});
