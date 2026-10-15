import { describe, expect, test } from "bun:test";
import {
  measurePermissionOverlayPlainWidths,
} from "../src/cli/components/permission-overlay.js";
import {
  formatPermissionAction,
  formatPermissionDetails,
  formatPermissionReason,
} from "../src/cli/permission-display.js";
import type { PermissionRequest } from "../src/permission/types.js";

const bashRequest: PermissionRequest = {
  id: "1",
  sessionID: "s1",
  permission: "bash",
  patterns: ["npm test"],
  message: "Execute: npm test",
  metadata: {
    command: "npm test -- --coverage",
    reason: "Run the test suite to verify the fix",
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
});

describe("formatPermissionDetails (modal redesign, #169)", () => {
  const bashWrite: PermissionRequest = {
    id: "2",
    sessionID: "s1",
    permission: "bash",
    patterns: ['echo "permission test" > /tmp/impulse-permission-test.txt'],
    message: "Execute: echo …",
    metadata: {
      command: 'echo "permission test" > /tmp/impulse-permission-test.txt',
      reason: "Write outside working directory: /tmp/impulse-permission-test.txt",
    },
  };

  test("redirect write derives action, full command, target, effect, why", () => {
    const d = formatPermissionDetails(bashWrite);
    expect(d.enriched).toBe(true);
    expect(d.action).toBe("Write file");
    expect(d.command).toBe('echo "permission test" > /tmp/impulse-permission-test.txt');
    expect(d.target).toBe("/tmp/impulse-permission-test.txt");
    expect(d.effect).toBe("Creates a new file; overwrites it if it already exists");
    expect(d.why).toContain("outside your working directory");
  });

  test("append redirect says append semantics", () => {
    const d = formatPermissionDetails({
      ...bashWrite,
      metadata: { command: "echo x >> /tmp/log.txt", reason: "Write outside working directory: /tmp/log.txt" },
    });
    expect(d.action).toBe("Append to file");
    expect(d.effect).toBe("Appends to the file if it exists; creates it if missing");
  });

  test("git push derives publish semantics", () => {
    const d = formatPermissionDetails({
      ...bashWrite,
      metadata: { command: "git push origin main", reason: "High-risk command" },
    });
    expect(d.enriched).toBe(true);
    expect(d.action).toBe("Push commits");
    expect(d.effect).toBe("Publishes commits to the remote repository");
  });

  test("file overwrite request enriches with target + effect", () => {
    const d = formatPermissionDetails({
      id: "3",
      sessionID: "s1",
      permission: "write",
      patterns: ["/tmp/out.txt"],
      message: "Overwrite file: /tmp/out.txt",
      metadata: { path: "/tmp/out.txt", isNewFile: false, reason: "Overwrite a file outside the project working directory" },
    });
    expect(d.enriched).toBe(true);
    expect(d.action).toBe("Overwrite file");
    expect(d.target).toBe("/tmp/out.txt");
    expect(d.effect).toBe("Overwrites the existing file");
  });

  test("unrecognized command falls back to the old short form", () => {
    const d = formatPermissionDetails(bashRequest);
    expect(d.enriched).toBe(false);
    expect(d.action).toBe("execute command: npm test -- --coverage");
  });
});
