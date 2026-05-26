import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
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

const { SessionStoreInstance } = await import("../src/session/store");
const { getProjectID } = await import("../src/session/store");

describe("SessionStore flushSave", () => {
  let projectID: string;

  beforeEach(() => {
    paths.home = mkdtempSync(path.join(tmpdir(), "impulse-home-"));
    paths.legacy = mkdtempSync(path.join(tmpdir(), "impulse-legacy-"));
    projectID = getProjectID(paths.home);
  });

  afterEach(() => {
    if (paths.home) rmSync(paths.home, { recursive: true, force: true });
    if (paths.legacy) rmSync(paths.legacy, { recursive: true, force: true });
  });

  it("writes pending autoSave updates immediately on flushSave", async () => {
    const session = await SessionStoreInstance.create({
      id: "sess_flush_test",
      name: "Flush test",
      projectID,
      directory: paths.home,
      messages: [],
      mode: "AGENT",
      model: "test/model",
      todos: [],
      context_window: 128_000,
      cost: 0,
    });

    SessionStoreInstance.autoSave(session.id, { name: "Updated name" });
    await SessionStoreInstance.flushSave(session.id);

    const filePath = path.join(
      paths.home,
      "sessions",
      projectID,
      "sess_flush_test.json"
    );
    const onDisk = JSON.parse(readFileSync(filePath, "utf-8")) as {
      name: string;
    };
    expect(onDisk.name).toBe("Updated name");
  });
});
