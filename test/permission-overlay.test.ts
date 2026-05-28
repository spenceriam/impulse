import { describe, expect, test } from "bun:test";
import {
  PermissionOverlay,
  measurePermissionOverlayPlainWidths,
} from "../src/cli/components/permission-overlay.js";
import { formatPermissionWhyPolicy } from "../src/cli/permission-display.js";
import { overlayMaxHeightForContent } from "../src/cli/overlay-height.js";
import type { PermissionRequest } from "../src/permission/index.js";

function bashRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "p1",
    sessionID: "s1",
    permission: "bash",
    patterns: ["rm -rf /"],
    message: "Execute: rm ...",
    metadata: {
      command: "rm -rf /tmp/example-with-a-very-long-path",
      reason: "High-risk command",
      description: "Remove stale build artifacts",
    },
    ...overrides,
  };
}

describe("formatPermissionWhyPolicy", () => {
  test("prefers agent description over generic reason", () => {
    const { why, policy } = formatPermissionWhyPolicy(bashRequest());
    expect(why).toBe("Remove stale build artifacts");
    expect(policy).toBe("High-risk command");
  });

  test("drops policy when identical to why", () => {
    const req = bashRequest({
      metadata: {
        command: "ls",
        description: "List files",
        reason: "List files",
      },
    });
    const { why, policy } = formatPermissionWhyPolicy(req);
    expect(why).toBe("List files");
    expect(policy).toBeUndefined();
  });
});

describe("PermissionOverlay", () => {
  test("preferredBoxWidth is narrower than full terminal for typical bash", () => {
    const overlay = new PermissionOverlay(bashRequest());
    overlay.setMeasureTerminalWidth(120);
    const pref = overlay.preferredBoxWidth(120);
    expect(pref).toBeLessThan(120);
    expect(pref).toBeGreaterThan(40);
  });

  test("render includes Why line when description present", () => {
    const overlay = new PermissionOverlay(bashRequest());
    overlay.setMeasureTerminalWidth(100);
    const lines = overlay.render(100);
    const plain = lines.join("\n");
    expect(plain).toContain("Why:");
    expect(plain).toContain("Remove stale build artifacts");
    expect(plain).toContain("Policy:");
    expect(plain).toContain("High-risk command");
  });

  test("long command produces more than 10 lines at reasonable width", () => {
    const cmd = "echo " + "x".repeat(200);
    const overlay = new PermissionOverlay(
      bashRequest({
        metadata: { command: cmd, reason: "High-risk command", description: "Test" },
      })
    );
    overlay.setMeasureTerminalWidth(80);
    const lines = overlay.render(80);
    expect(lines.length).toBeGreaterThan(10);
    const maxH = overlayMaxHeightForContent(40, lines.length);
    expect(maxH).toBeGreaterThan(10);
  });

  test("render at preferred width keeps every line at host width", () => {
    const overlay = new PermissionOverlay(bashRequest());
    overlay.setMeasureTerminalWidth(100);
    const pref = overlay.preferredBoxWidth(100);
    const widths = measurePermissionOverlayPlainWidths(bashRequest(), pref);
    for (const w of widths) {
      expect(w).toBe(pref);
    }
  });
});
