import { beforeEach, describe, expect, test } from "bun:test";
import {
  configureApprovalPolicy,
  effectiveApprovalPolicy,
  persistedApprovalPolicy,
  resetApprovalPolicyForTests,
} from "../src/permission/policy.js";

describe("startup Allow-All override", () => {
  beforeEach(() => resetApprovalPolicyForTests());

  test("launch override is effective without claiming persistence", () => {
    configureApprovalPolicy({ persisted: "prompt", launchOverride: "allow-all" });
    expect(effectiveApprovalPolicy()).toBe("allow-all");
    expect(persistedApprovalPolicy()).toBe("prompt");
  });

  test("persisted Allow-All remains active without a launch override", () => {
    configureApprovalPolicy({ persisted: "allow-all" });
    expect(effectiveApprovalPolicy()).toBe("allow-all");
    expect(persistedApprovalPolicy()).toBe("allow-all");
  });

  test("a new launch without override restores the persisted policy", () => {
    configureApprovalPolicy({ persisted: "prompt", launchOverride: "allow-all" });
    configureApprovalPolicy({ persisted: "prompt" });
    expect(effectiveApprovalPolicy()).toBe("prompt");
  });
});
