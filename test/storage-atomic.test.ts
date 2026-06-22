import { describe, expect, test } from "bun:test";
import { Storage } from "../src/storage/index.js";

describe("Storage.write", () => {
  test("persists JSON through generic storage", async () => {
    const key = ["test-storage-atomic", `${process.pid}-${Date.now()}`];
    try {
      await Storage.write(key, { ok: true });
      await expect(Storage.read(key)).resolves.toEqual({ ok: true });
    } finally {
      await Storage.remove(key);
    }
  });
});
