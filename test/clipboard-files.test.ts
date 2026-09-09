import { describe, expect, test } from "bun:test";
import { readClipboardFileList } from "../src/cli/clipboard-files.js";

describe("readClipboardFileList (#134)", () => {
  test("returns a well-formed result on every platform without throwing", async () => {
    // Best-effort by contract: whatever the platform clipboard holds, the
    // call must resolve to { files, present } — never reject.
    const result = await readClipboardFileList();
    expect(Array.isArray(result.files)).toBe(true);
    expect(typeof result.present).toBe("boolean");
    for (const f of result.files) {
      expect(typeof f).toBe("string");
      expect(f.length).toBeGreaterThan(0);
    }
  });
});