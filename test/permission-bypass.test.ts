import { describe, expect, test } from "bun:test";
import { ask, resetAllowAllBypass, setAllowAllBypass } from "../src/permission/index.js";

describe("allow-all bypass exemption (#143)", () => {
  test("non-exempt asks auto-approve under the bypass", async () => {
    setAllowAllBypass(true);
    // Resolves immediately — no prompt published.
    await ask({ sessionID: "t", permission: "bash", patterns: ["x"], message: "m" });
    resetAllowAllBypass();
  });

  test("exempt (absolutely-destructive) asks still prompt under the bypass", async () => {
    setAllowAllBypass(true);
    let settled = false;
    const p = ask({
      sessionID: "t",
      permission: "bash",
      patterns: ["rm -rf build"],
      message: "Execute: rm -rf build",
      exemptFromBypass: true,
    });
    p.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false); // still waiting on a user decision
    resetAllowAllBypass();
  });

  test("exempt asks prompt normally without the bypass", async () => {
    resetAllowAllBypass();
    let settled = false;
    const p = ask({
      sessionID: "t",
      permission: "bash",
      patterns: ["rm -rf build"],
      message: "Execute: rm -rf build",
      exemptFromBypass: true,
    });
    p.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false);
  });
});
