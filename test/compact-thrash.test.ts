import { describe, expect, test } from "bun:test";
import {
  autoCompactEligible,
  MIN_NEW_MESSAGES_AFTER_COMPACT,
} from "../src/session/compact.js";

describe("autoCompactEligible (#179 thrash guard)", () => {
  test("does not compact with only the summary + recent tail present", () => {
    // keepRecentCount=20, only 20 or 21 messages (summary + tail) — tail alone
    // exceeding the threshold must not start a summarizer cycle.
    expect(autoCompactEligible(20, 20)).toBe(false);
    expect(autoCompactEligible(25, 20)).toBe(false); // summary + 20 tail = 21…25
  });

  test("compacts only after enough new messages accumulate", () => {
    expect(autoCompactEligible(25, 20)).toBe(false);
    expect(autoCompactEligible(26, 20)).toBe(true); // 20 tail + 6 new > min
    expect(autoCompactEligible(130, 20)).toBe(true);
  });

  test("respects a custom minimum", () => {
    expect(autoCompactEligible(20 + MIN_NEW_MESSAGES_AFTER_COMPACT, 20, 10)).toBe(false);
    expect(autoCompactEligible(31, 20, 10)).toBe(true);
  });
});
