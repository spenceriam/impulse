import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
  ChatExperiencePicker,
  ChatPreviewOverlay,
  frameAt,
  PREVIEW_LOOP_MS,
  previewScript,
} from "../src/cli/components/chat-preview-overlay.js";

const W = 78;
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const frameRows = (density: "quiet" | "verbose", t: number) => {
  const script = previewScript(density);
  return strip(frameAt(script, t).rows(W).join("\n"));
};

describe("preview script (#160)", () => {
  test("quiet and verbose start from the same prompt", () => {
    expect(frameRows("quiet", 0)).toContain("Review what changed this week");
    expect(frameRows("verbose", 0)).toContain("Review what changed this week");
  });

  test("the two densities end differently", () => {
    expect(frameRows("quiet", 4500)).toContain("Recap:");
    expect(frameRows("verbose", 4500)).toContain("file_read");
    expect(frameRows("quiet", 4500)).not.toBe(frameRows("verbose", 4500));
  });

  test("quiet narration comes from the real formatter, no raw italic markers", () => {
    const rows = frameRows("quiet", 1300);
    expect(rows).toContain("CHANGELOG.md");
    expect(rows).not.toContain("_Reading");
    expect(rows).toContain("(2s)");
  });

  test("verbose tool rows are separate chat rows", () => {
    const rows = frameRows("verbose", 1300);
    const lines = rows.split("\n").filter((l) => l.trim());
    const bash = lines.findIndex((l) => l.includes("git log"));
    const read = lines.findIndex((l) => l.includes("CHANGELOG.md") && l.includes("file_read"));
    expect(bash).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(bash);
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
    expect(overlay.render(W)).toHaveLength(10);
    expect(overlay.render(W)).toHaveLength(10);
  });

  test("switching density shows the other density's settled turn", () => {
    const overlay = new ChatPreviewOverlay({ density: "quiet", startAtMs: 4500 });
    overlay.setDensity("verbose");
    const out = strip(overlay.render(W).join("\n"));
    expect(out).toContain("Review what changed this week");
    expect(out).toContain("file_read");
    expect(out).not.toContain("Recap:");
  });

  test("later frames show the prose and Recap (the earlier tests missed this)", () => {
    const real = Date.now;
    let offset = 0;
    Date.now = () => real() + offset;
    try {
      const overlay = new ChatPreviewOverlay({ density: "quiet", startAtMs: 0 });
      offset = 4500;
      const out = strip(overlay.render(W).join("\n"));
      expect(out).toContain("Worked for 3s using 2 tools");
      expect(out).toContain("Three commits landed");
      expect(out).toContain("Recap:");
    } finally {
      Date.now = real;
    }
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
      expect(visibleWidth(line.replace(/\x1b\[[0-9;]*m/g, ""))).toBeLessThanOrEqual(60);
    }
  });
});
