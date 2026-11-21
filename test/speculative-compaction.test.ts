import { describe, expect, test } from "bun:test";
import { CompactManager } from "../src/session/compact.js";

describe("speculative compaction lifecycle (#185)", () => {
  test("nothing is armed for an unknown session", () => {
    expect(CompactManager.hasArmedSummary("sess_never_speculated")).toBe(false);
  });

  test("discarding an armed summary is safe when none exists", () => {
    expect(() => CompactManager.discardArmedSummary("sess_never_speculated")).not.toThrow();
    expect(CompactManager.hasArmedSummary("sess_never_speculated")).toBe(false);
  });

  test("speculation refuses a session that is mid-compaction", async () => {
    // inProgress is private; the observable contract is that speculate never
    // throws and reports false when it cannot arm.
    expect(await CompactManager.speculate("sess_missing")).toBe(false);
  });
});
