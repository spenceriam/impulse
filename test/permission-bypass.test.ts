import { describe, expect, test } from "bun:test";
import {
  ask,
  getPermissionBypass,
  resetAllowAllBypass,
  setPermissionBypass,
} from "../src/permission/index.js";

function staysPending(input: Parameters<typeof ask>[0]): Promise<boolean> {
  let settled = false;
  const p = ask(input);
  p.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  return new Promise((resolve) =>
    setTimeout(() => resolve(!settled), 25)
  );
}

describe("permission bypass modes (#143)", () => {
  test("gated (off): everything prompts normally", async () => {
    setPermissionBypass("off");
    await expect(staysPending({ sessionID: "t", permission: "bash", patterns: ["x"], message: "m" })).resolves.toBe(true);
    await expect(
      staysPending({ sessionID: "t", permission: "bash", patterns: ["rm -rf x"], message: "m", exemptFromBypass: true })
    ).resolves.toBe(true);
  });

  test("trust: non-destructive auto-approves; destructive still prompts", async () => {
    setPermissionBypass("trust");
    expect(getPermissionBypass()).toBe("trust");
    // Non-exempt resolves immediately (no prompt)
    await ask({ sessionID: "t", permission: "bash", patterns: ["x"], message: "m" });
    // Exempt (absolutely-destructive) still waits on the user
    await expect(
      staysPending({ sessionID: "t", permission: "bash", patterns: ["rm -rf x"], message: "m", exemptFromBypass: true })
    ).resolves.toBe(true);
  });

  test("full: nothing asks — even destructive", async () => {
    setPermissionBypass("full");
    await ask({ sessionID: "t", permission: "bash", patterns: ["x"], message: "m" });
    await ask({
      sessionID: "t",
      permission: "bash",
      patterns: ["rm -rf x"],
      message: "m",
      exemptFromBypass: true,
    });
  });

  test("reset clears the mode", () => {
    setPermissionBypass("full");
    resetAllowAllBypass();
    expect(getPermissionBypass()).toBe("off");
  });
});
