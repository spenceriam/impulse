import { describe, expect, test } from "bun:test";
import { filterThinkingForDisplay } from "../src/util/thinking-filter.js";
import { splitAtSafeBoundary } from "../src/cli/stream-split.js";

/**
 * Mirrors ImpulseRenderer.appendWorkerThinking's decision logic (renderer.ts
 * is a TUI-instantiated class, not unit-testable directly — see
 * allow-all-startup.test.ts for the established pattern of mirroring the
 * decision here against the real, exported pure helpers it calls).
 *
 * The bug (§5-0): a thinking delta opening mid-response used to call
 * finalizeAssistantStreamingSegment(false) unconditionally — hard-cutting the
 * streaming text at whatever character the last content chunk ended on, even
 * when the delta was empty/whitespace after filtering. The fix: (1) an empty
 * filtered delta must never touch the stream, and (2) a real delta must only
 * freeze at a safe markdown boundary (allowLineCut: true), carrying an unsafe
 * remainder forward instead of splitting it.
 */
function shouldOpenThinkingBlock(rawDelta: string): boolean {
  return filterThinkingForDisplay(rawDelta).trim().length > 0;
}

/** Mirrors freezeStreamingAtSafeBoundary(true) applied to a live streamingRaw buffer. */
function mirrorFreezeForThinkingInterrupt(streamingRaw: string): {
  froze: boolean;
  frozen: string;
  remainder: string;
} {
  const split = splitAtSafeBoundary(streamingRaw, { allowLineCut: true });
  if (!split) return { froze: false, frozen: "", remainder: streamingRaw };
  return { froze: true, frozen: split.frozen, remainder: split.remainder };
}

describe("thinking-stream interleave decision (§5-0)", () => {
  test("an empty delta before any real thinking content never opens a block", () => {
    expect(shouldOpenThinkingBlock("")).toBe(false);
    expect(shouldOpenThinkingBlock("   ")).toBe(false);
    expect(shouldOpenThinkingBlock("\n\n")).toBe(false);
  });

  test("a delta that is pure DSML/tool-XML markup filters to empty and never opens a block", () => {
    expect(shouldOpenThinkingBlock("<|tool_call_begin|>")).toBe(false);
  });

  test("real reasoning text opens a block", () => {
    expect(shouldOpenThinkingBlock("Let me check the file first")).toBe(true);
  });

  test("an empty-delta open never disturbs an in-progress streaming buffer", () => {
    // Simulates: onToken("Current version") then a whitespace-only reasoning
    // delta arrives. The guard must fire before any freeze is attempted.
    const streamingRaw = "Current version";
    const shouldOpen = shouldOpenThinkingBlock("   ");
    expect(shouldOpen).toBe(false);
    // streamingRaw is untouched — no freeze call happens at all in this path.
    expect(streamingRaw).toBe("Current version");
  });

  test("a real thinking interrupt mid-bold-span defers rather than splitting it", () => {
    // Reproduces the exact reported artifact: "**" then "Current version:** v1.9.0"
    // rendered as two separate blocks because the old code hard-cut right after "**".
    const streamingRaw = "**Current version";
    const result = mirrorFreezeForThinkingInterrupt(streamingRaw);
    // No complete line/paragraph boundary exists yet — must defer, not tear the bold span.
    expect(result.froze).toBe(false);
    expect(result.remainder).toBe(streamingRaw);
  });

  test("a real thinking interrupt after a complete line freezes only the safe prefix", () => {
    const streamingRaw = "The main tension is provider-flexibility.\nOngoing work";
    const result = mirrorFreezeForThinkingInterrupt(streamingRaw);
    expect(result.froze).toBe(true);
    expect(result.frozen).toBe("The main tension is provider-flexibility.");
    expect(result.remainder).toBe("Ongoing work");
  });
});
