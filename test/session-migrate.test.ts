import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import fs from "fs/promises";
import path from "path";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";

const paths = {
  home: "",
  legacy: "",
};

mock.module("../src/global", () => ({
  Global: {
    Path: {
      get home() {
        return paths.home;
      },
      get config() {
        return paths.home;
      },
      get data() {
        return paths.home;
      },
      get sessions() {
        return path.join(paths.home, "sessions");
      },
      get logs() {
        return path.join(paths.home, "logs");
      },
      get cache() {
        return path.join(paths.home, "cache");
      },
      get legacyData() {
        return paths.legacy;
      },
    },
  },
}));

const { migrateHomeIfNeeded } = await import("../src/session/migrate-home");

describe("migrateHomeIfNeeded", () => {
  beforeEach(() => {
    paths.home = mkdtempSync(path.join(tmpdir(), "impulse-migrate-home-"));
    paths.legacy = mkdtempSync(path.join(tmpdir(), "impulse-migrate-legacy-"));
  });

  afterEach(() => {
    if (paths.home) rmSync(paths.home, { recursive: true, force: true });
    if (paths.legacy) rmSync(paths.legacy, { recursive: true, force: true });
  });

  it("copies legacy config and sessions into ~/.impulse layout", async () => {
    await fs.mkdir(path.join(paths.legacy, "storage", "session", "proj1"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(paths.legacy, "config.json"),
      JSON.stringify({ defaultModel: "test" }),
      "utf-8"
    );
    await fs.writeFile(
      path.join(paths.legacy, "storage", "session", "proj1", "sess_a.json"),
      JSON.stringify({ id: "sess_a", name: "Legacy session" }),
      "utf-8"
    );

    const migrated = await migrateHomeIfNeeded();
    expect(migrated).toBe(true);

    const config = JSON.parse(
      readFileSync(path.join(paths.home, "config.json"), "utf-8")
    ) as { defaultModel: string };
    expect(config.defaultModel).toBe("test");

    const session = readFileSync(
      path.join(paths.home, "sessions", "proj1", "sess_a.json"),
      "utf-8"
    );
    expect(session).toContain("Legacy session");
  });

  it("is idempotent when destination already exists", async () => {
    await fs.mkdir(paths.home, { recursive: true });
    await fs.writeFile(
      path.join(paths.home, "config.json"),
      JSON.stringify({ kept: true }),
      "utf-8"
    );
    await fs.writeFile(
      path.join(paths.legacy, "config.json"),
      JSON.stringify({ kept: false }),
      "utf-8"
    );

    const migrated = await migrateHomeIfNeeded();
    expect(migrated).toBe(false);

    const config = JSON.parse(
      readFileSync(path.join(paths.home, "config.json"), "utf-8")
    ) as { kept: boolean };
    expect(config.kept).toBe(true);
  });
});
