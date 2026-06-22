import { describe, expect, test } from "bun:test";
import {
  formatUpdateSuccessLines,
  INTERNAL_AUTO_UPDATE_ENV,
  isInternalAutoUpdate,
} from "../src/util/update-check.js";

describe("update mode helpers", () => {
  test("standalone update success message does not relaunch", () => {
    const lines = formatUpdateSuccessLines("1.8.1", "1.8.1", false);
    expect(lines.some((line) => line.includes("Relaunching impulse"))).toBe(false);
    expect(lines).toContain("  Run `impulse` to start.");
  });

  test("internal auto-update success message relaunches", () => {
    const lines = formatUpdateSuccessLines("1.8.1", "1.8.1", true);
    expect(lines).toContain("  Relaunching impulse...");
    expect(lines.some((line) => line.includes("Run `impulse`"))).toBe(false);
  });

  test("manual --auto-update is not internal without env marker", () => {
    expect(isInternalAutoUpdate(["--auto-update"], {})).toBe(false);
  });

  test("--auto-update is internal only with env marker", () => {
    expect(isInternalAutoUpdate(["--auto-update"], { [INTERNAL_AUTO_UPDATE_ENV]: "1" })).toBe(true);
  });
});
