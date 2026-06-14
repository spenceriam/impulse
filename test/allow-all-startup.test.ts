import { describe, expect, test, beforeEach } from "bun:test";
import {
  isAllowAllBypass,
  resetAllowAllBypass,
  setAllowAllBypass,
} from "../src/permission/index.js";

/**
 * Mirrors ImpulseRenderer.applyAllowAllForSessionScope (session switch contract).
 * Stickiness is driven by the accepted startup disclaimer, not the raw --aa flag.
 */
function applyAllowAllForSessionScope(allowAllStartupAgreed: boolean): void {
  resetAllowAllBypass();
  if (allowAllStartupAgreed) {
    setAllowAllBypass(true);
  }
}

describe("startup allow-all session scope", () => {
  beforeEach(() => {
    resetAllowAllBypass();
  });

  test("agreed disclaimer re-applies after session-scope reset", () => {
    applyAllowAllForSessionScope(true);
    expect(isAllowAllBypass()).toBe(true);
    applyAllowAllForSessionScope(true);
    expect(isAllowAllBypass()).toBe(true);
  });

  test("declined startup disclaimer stays off across session switch", () => {
    applyAllowAllForSessionScope(false);
    expect(isAllowAllBypass()).toBe(false);
  });

  test("per-session allow-all cleared on session switch when not sticky", () => {
    setAllowAllBypass(true);
    expect(isAllowAllBypass()).toBe(true);
    applyAllowAllForSessionScope(false);
    expect(isAllowAllBypass()).toBe(false);
  });

  test("user toggle off clears startup sticky across session switch", () => {
    let allowAllStartupAgreed = true;
    applyAllowAllForSessionScope(allowAllStartupAgreed);
    expect(isAllowAllBypass()).toBe(true);

    allowAllStartupAgreed = false;
    setAllowAllBypass(false);

    applyAllowAllForSessionScope(allowAllStartupAgreed);
    expect(isAllowAllBypass()).toBe(false);
  });
});
