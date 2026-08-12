import { afterEach, describe, expect, test } from "bun:test";
import {
  configureApprovalPolicy,
  effectiveApprovalPolicy,
  persistedApprovalPolicy,
  resetApprovalPolicyForTests,
  setPersistedApprovalPolicy,
  type ApprovalPolicy,
} from "../src/permission/policy.js";
import { createDefaultConfig, saveConfigFileAtomic } from "../src/util/config.js";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ask, PermissionEvents, respond } from "../src/permission/index.js";
import { Bus } from "../src/bus/index.js";

afterEach(() => resetApprovalPolicyForTests());

describe("approval policy", () => {
  test("defaults independently to prompt", () => {
    expect(createDefaultConfig().approvalPolicy).toBe("prompt");
    expect(persistedApprovalPolicy()).toBe("prompt");
    expect(effectiveApprovalPolicy()).toBe("prompt");
  });

  test("launch override is effective but does not alter persisted policy", () => {
    configureApprovalPolicy({ persisted: "prompt", launchOverride: "allow-all" });
    expect(effectiveApprovalPolicy()).toBe("allow-all");
    expect(persistedApprovalPolicy()).toBe("prompt");
  });

  test("persisted changes are reversible while launch override remains ephemeral", () => {
    setPersistedApprovalPolicy("allow-all");
    expect(persistedApprovalPolicy()).toBe("allow-all");
    expect(effectiveApprovalPolicy()).toBe("allow-all");

    setPersistedApprovalPolicy("prompt");
    expect(effectiveApprovalPolicy()).toBe("prompt");
  });

  test("global config persists approvalPolicy", async () => {
    const root = await mkdtemp(join(tmpdir(), "impulse-policy-"));
    const target = join(root, "config.json");
    try {
      await saveConfigFileAtomic(
        createDefaultConfig({ approvalPolicy: "allow-all" as ApprovalPolicy }),
        target
      );
      const stored = JSON.parse(await readFile(target, "utf8"));
      expect(stored.approvalPolicy).toBe("allow-all");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("permission.ask follows policy without changing execution boundaries", async () => {
    let askedId = "";
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type === PermissionEvents.Asked.name) {
        askedId = (event.properties as { id: string }).id;
      }
    });
    try {
      configureApprovalPolicy({ persisted: "allow-all" });
      await ask({ sessionID: "policy-test", permission: "bash", patterns: ["echo ok"], message: "test" });
      expect(askedId).toBe("");

      configureApprovalPolicy({ persisted: "prompt" });
      const pending = ask({ sessionID: "policy-test", permission: "bash", patterns: ["echo prompt"], message: "test" });
      expect(askedId).not.toBe("");
      respond({ permissionID: askedId, response: "once" });
      await pending;
    } finally {
      unsubscribe();
    }
  });
});
