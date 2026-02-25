import { describe, expect, test } from "bun:test";
import { isAutoApprovalAffirmative } from "../src/util/auto-approval";

describe("AUTO approval parser", () => {
  test("accepts common affirmative phrases", () => {
    expect(isAutoApprovalAffirmative("Yes")).toBe(true);
    expect(isAutoApprovalAffirmative("Yes, start building")).toBe(true);
    expect(isAutoApprovalAffirmative("Approved - full execution")).toBe(true);
    expect(isAutoApprovalAffirmative("ok proceed")).toBe(true);
  });

  test("rejects explicit negatives", () => {
    expect(isAutoApprovalAffirmative("No")).toBe(false);
    expect(isAutoApprovalAffirmative("Do not execute")).toBe(false);
    expect(isAutoApprovalAffirmative("Don't proceed")).toBe(false);
  });
});
