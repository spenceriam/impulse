import { describe, expect, test } from "bun:test";
import { ALLOW_ALL_WARNING } from "../src/permission/policy.js";
import { AllowAllDisclaimerOverlay } from "../src/cli/components/allow-all-disclaimer-overlay.js";

describe("Allow-All warning", () => {
  test("uses the exact concise non-sandbox disclaimer", () => {
    expect(ALLOW_ALL_WARNING).toBe(
      "Allow-All skips permission prompts; it does not sandbox commands or protect files/network; use only with a trusted workspace or active sandbox."
    );
    const text = new AllowAllDisclaimerOverlay()
      .render(100)
      .join("\n")
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    expect(text.replace(/[│┌┐└┘─]/g, " ").replace(/\s+/g, " ")).toContain(ALLOW_ALL_WARNING);
    expect(text).not.toContain("not responsible");
  });
});
