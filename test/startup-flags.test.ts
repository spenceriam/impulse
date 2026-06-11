import { describe, expect, test } from "bun:test";
import { parseStartupFlags } from "../src/cli/startup-flags.js";

describe("parseStartupFlags", () => {
  test("detects --aa and strips it from argv", () => {
    const { flags, argv } = parseStartupFlags(["--aa", "hello"]);
    expect(flags.allowAllOnStartup).toBe(true);
    expect(argv).toEqual(["hello"]);
  });

  test("detects --allow-all alias", () => {
    const { flags, argv } = parseStartupFlags(["impulse", "--allow-all"]);
    expect(flags.allowAllOnStartup).toBe(true);
    expect(argv).toEqual(["impulse"]);
  });

  test("respects IMPULSE_ALLOW_ALL=1", () => {
    const prev = process.env["IMPULSE_ALLOW_ALL"];
    process.env["IMPULSE_ALLOW_ALL"] = "1";
    try {
      const { flags } = parseStartupFlags([]);
      expect(flags.allowAllOnStartup).toBe(true);
    } finally {
      if (prev === undefined) delete process.env["IMPULSE_ALLOW_ALL"];
      else process.env["IMPULSE_ALLOW_ALL"] = prev;
    }
  });

  test("defaults to false without flags or env", () => {
    const prev = process.env["IMPULSE_ALLOW_ALL"];
    delete process.env["IMPULSE_ALLOW_ALL"];
    try {
      const { flags } = parseStartupFlags(["--verbose"]);
      expect(flags.allowAllOnStartup).toBe(false);
    } finally {
      if (prev !== undefined) process.env["IMPULSE_ALLOW_ALL"] = prev;
    }
  });
});
