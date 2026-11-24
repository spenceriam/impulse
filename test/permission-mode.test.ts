import { afterEach, describe, expect, test } from "bun:test";
import {
  ask,
  getPermissionBypass,
  permissionBypassForMode,
  resetAllowAllBypass,
  setPermissionBypass,
} from "../src/permission/index.js";

afterEach(() => resetAllowAllBypass());

describe("permissionBypassForMode (#225)", () => {
  test("maps the persisted posture to the live bypass", () => {
    expect(permissionBypassForMode("gated")).toBe("off");
    expect(permissionBypassForMode("trust")).toBe("trust");
    expect(permissionBypassForMode("full-auto")).toBe("full");
  });
});

describe("live bypass (#225)", () => {
  test("Full Auto asks nothing", async () => {
    setPermissionBypass(permissionBypassForMode("full-auto"));
    expect(getPermissionBypass()).toBe("full");
    // Resolves without creating a pending request (which would hang here).
    await ask({
      sessionID: "s1",
      permission: "bash",
      patterns: ["curl https://example.com"],
      message: "Execute: curl https://example.com",
    });
  });

  test("Trust asks nothing for an ordinary command", async () => {
    setPermissionBypass(permissionBypassForMode("trust"));
    await ask({
      sessionID: "s1",
      permission: "bash",
      patterns: ["curl https://example.com"],
      message: "Execute: curl https://example.com",
    });
  });

  test("switching back to Gated clears the bypass", () => {
    setPermissionBypass(permissionBypassForMode("full-auto"));
    resetAllowAllBypass();
    setPermissionBypass(permissionBypassForMode("gated"));
    expect(getPermissionBypass()).toBe("off");
  });
});
