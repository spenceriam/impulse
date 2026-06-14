import { describe, expect, test } from "bun:test";
import {
  findUnknownFlag,
  parseStartupFlags,
} from "../src/cli/startup-flags.js";

describe("findUnknownFlag", () => {
  test("returns unknown typos", () => {
    expect(findUnknownFlag(["--updat"])).toBe("--updat");
    expect(findUnknownFlag(["--verbose"])).toBe("--verbose");
  });

  test("accepts known boolean flags", () => {
    expect(findUnknownFlag(["--version"])).toBeUndefined();
    expect(findUnknownFlag(["--update"])).toBeUndefined();
    expect(findUnknownFlag(["--aa"])).toBeUndefined();
    expect(findUnknownFlag(["--allow-all"])).toBeUndefined();
    expect(findUnknownFlag(["--resume"])).toBeUndefined();
    expect(findUnknownFlag(["-r"])).toBeUndefined();
  });

  test("accepts value flags with their values", () => {
    expect(findUnknownFlag(["--limit", "5"])).toBeUndefined();
    expect(findUnknownFlag(["--project", "current"])).toBeUndefined();
    expect(findUnknownFlag(["--resume", "abc123"])).toBeUndefined();
  });

  test("ignores tokens after -- end-of-options", () => {
    expect(findUnknownFlag(["--", "--weird"])).toBeUndefined();
    expect(findUnknownFlag(["--aa", "--", "--updat"])).toBeUndefined();
  });

  test("ignores dash-prefixed words in trailing message args", () => {
    expect(findUnknownFlag(["explain", "the", "-j", "option"])).toBeUndefined();
    expect(findUnknownFlag(["--aa", "explain", "the", "-j", "option"])).toBeUndefined();
  });
});

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

  test("ignores --aa and --allow-all after -- end-of-options", () => {
    const prev = process.env["IMPULSE_ALLOW_ALL"];
    delete process.env["IMPULSE_ALLOW_ALL"];
    try {
      const aa = parseStartupFlags(["--", "--aa"]);
      expect(aa.flags.allowAllOnStartup).toBe(false);
      expect(aa.argv).toEqual(["--", "--aa"]);

      const allowAll = parseStartupFlags(["--", "--allow-all"]);
      expect(allowAll.flags.allowAllOnStartup).toBe(false);
      expect(allowAll.argv).toEqual(["--", "--allow-all"]);
    } finally {
      if (prev !== undefined) process.env["IMPULSE_ALLOW_ALL"] = prev;
    }
  });
});
