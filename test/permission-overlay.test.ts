import { describe, expect, test } from "bun:test";
import {
  measurePermissionOverlayPlainWidths,
  PermissionOverlay,
} from "../src/cli/components/permission-overlay.js";
import {
  formatPermissionAction,
  formatPermissionReason,
} from "../src/cli/permission-display.js";
import type { PermissionRequest } from "../src/permission/types.js";
import { assertGutterSafeAcrossWidths } from "./helpers/gutter-assertions.js";

const bashRequest: PermissionRequest = {
  id: "1",
  sessionID: "s1",
  permission: "bash",
  patterns: ["npm test"],
  message: "Execute: npm test",
  metadata: {
    command: "npm test -- --coverage",
    reason: "Run the test suite to verify the fix",
    executionBoundary: "HOST",
    approvalPolicy: "PROMPT",
  },
};

describe("permission overlay", () => {
  test("action line uses short command not full path headline", () => {
    expect(formatPermissionAction(bashRequest)).toBe(
      "execute command: npm test -- --coverage"
    );
    expect(formatPermissionReason(bashRequest)).toBe(
      "Run the test suite to verify the fix"
    );
  });

  test("distinguishes technical boundary from approval policy", () => {
    const text = new PermissionOverlay(bashRequest)
      .render(100)
      .join("\n")
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    expect(text).toContain("HOST · PROMPT");
  });

  test("reason is capped at 120 chars", () => {
    const long = "x".repeat(200);
    const req: PermissionRequest = {
      ...bashRequest,
      metadata: { ...bashRequest.metadata, reason: long },
    };
    expect(formatPermissionReason(req).length).toBeLessThanOrEqual(120);
    expect(formatPermissionReason(req).endsWith("…")).toBe(true);
  });

  test("rendered box rows share consistent width at narrow floor", () => {
    const widths = measurePermissionOverlayPlainWidths(bashRequest, 28);
    expect(widths.length).toBeGreaterThan(4);
    const boxWidth = widths[0]!;
    for (const w of widths) {
      expect(w).toBe(boxWidth);
    }
  });

  test("gutter-safe across narrow widths", () => {
    assertGutterSafeAcrossWidths((width) =>
      new PermissionOverlay(bashRequest).render(width)
    );
  });

  test("gutter-safe with a long reason string that forces wrapping", () => {
    const longReasonRequest: PermissionRequest = {
      ...bashRequest,
      metadata: { ...bashRequest.metadata, reason: "x".repeat(200) },
    };
    assertGutterSafeAcrossWidths((width) =>
      new PermissionOverlay(longReasonRequest).render(width)
    );
  });
});
