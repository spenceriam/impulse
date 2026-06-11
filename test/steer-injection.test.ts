import { describe, expect, test } from "bun:test";
import { formatSteeringNote } from "../src/agent/steer-injection.js";
import { PLANNING_LOOP_NUDGE_MESSAGE } from "../src/agent/planning-nudge.js";
import { ALLOW_ALL_TODO_NUDGE_MESSAGE } from "../src/agent/allow-all-nudge.js";

describe("steer injection", () => {
  test("formatSteeringNote tells model to override and acknowledge", () => {
    const note = formatSteeringNote("hold on and wipe the folder");
    expect(note).toContain("overrides prior instructions");
    expect(note).toContain("hold on and wipe the folder");
    expect(note).toContain("briefly acknowledge");
    expect(note).not.toContain("do not acknowledge");
  });

  test("steering note and nudge messages are distinct", () => {
    const steer = formatSteeringNote("skip phase 5");
    expect(steer).not.toContain(PLANNING_LOOP_NUDGE_MESSAGE);
    expect(steer).not.toContain(ALLOW_ALL_TODO_NUDGE_MESSAGE);
  });
});
