import { describe, expect, test } from "bun:test";
import { isAutoApprovalAffirmed } from "../src/util/auto-approval";

describe("AUTO approval answer parsing", () => {
  test("accepts affirmative phrase labels from question options", () => {
    expect(isAutoApprovalAffirmed("Yes, execute")).toBe(true);
    expect(isAutoApprovalAffirmed("Approved - full execution")).toBe(true);
    expect(isAutoApprovalAffirmed("Proceed with implementation")).toBe(true);
  });

  test("rejects negative answers", () => {
    expect(isAutoApprovalAffirmed("No, stop")).toBe(false);
    expect(isAutoApprovalAffirmed("Decline for now")).toBe(false);
    expect(isAutoApprovalAffirmed("Don't proceed")).toBe(false);
  });
});
