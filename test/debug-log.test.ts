import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import {
  disableDebugLog,
  enableDebugLog,
  getDebugLogPath,
  isDebugEnabled,
  logAPIRequest,
} from "../src/util/debug-log.js";

describe("debug log JSONL", () => {
  test("enableDebugLog writes api_request entries", async () => {
    disableDebugLog();
    const path = await enableDebugLog();
    expect(isDebugEnabled()).toBe(true);
    expect(path).toContain("session-");
    expect(path.endsWith(".jsonl")).toBe(true);

    await logAPIRequest("test-model", [{ role: "user", content: "hello" }], []);

    const jsonl = await fs.readFile(path, "utf-8");
    expect(jsonl).toContain('"type":"api_request"');
    expect(jsonl).toContain('"messageCount":1');

    disableDebugLog();
    expect(isDebugEnabled()).toBe(false);
    expect(getDebugLogPath()).toBeNull();

    await fs.unlink(path);
  });
});
