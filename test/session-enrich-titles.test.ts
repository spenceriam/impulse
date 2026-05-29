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
import type { Session } from "../src/session/store";

const paths = { home: "", legacy: "" };

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

const generateTitleMock = mock(() => Promise.resolve("Generated title" as string | null));

mock.module("../src/session/title-generator", () => ({
  generateTitle: generateTitleMock,
  hasTitleSource: (messages: Session["messages"]) => {
    const hasUser = messages.some((m) => m.role === "user");
    const hasAssistant = messages.some((m) => m.role === "assistant");
    return hasUser && hasAssistant;
  },
  buildTitleMessages: () => [{ role: "user", content: "hi" }],
}));

const { SessionStoreInstance, getProjectID } = await import("../src/session/store");
const {
  isEligibleForTitleEnrichment,
  enrichSessionTitles,
  resolveTitleModel,
} = await import("../src/session/enrich-titles");

function sampleSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess_enrich_test",
    name: "Session May 25 at 02:00 PM",
    projectID: "proj1",
    directory: "/tmp",
    created_at: "2026-05-25T12:00:00.000Z",
    updated_at: "2026-05-25T14:00:00.000Z",
    messages: [
      { role: "user", content: "Hello", timestamp: "2026-05-25T12:00:00.000Z" },
      {
        role: "assistant",
        content: "Hi there",
        timestamp: "2026-05-25T12:01:00.000Z",
      },
    ],
    mode: "AGENT",
    model: "",
    todos: [],
    context_window: 128000,
    cost: 0,
    ...overrides,
  };
}

describe("isEligibleForTitleEnrichment", () => {
  it("eligible when user and assistant messages and no headerTitle", () => {
    expect(isEligibleForTitleEnrichment(sampleSession()).eligible).toBe(true);
  });

  it("skips when headerTitle exists", () => {
    const r = isEligibleForTitleEnrichment(
      sampleSession({ headerTitle: "Already titled" })
    );
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("has_title");
  });

  it("skips when no assistant reply", () => {
    const r = isEligibleForTitleEnrichment(
      sampleSession({
        messages: [
          { role: "user", content: "solo", timestamp: "2026-05-25T12:00:00.000Z" },
        ],
      })
    );
    expect(r.eligible).toBe(false);
  });
});

describe("resolveTitleModel", () => {
  it("prefers session model over default", () => {
    const m = resolveTitleModel(sampleSession({ model: "ollama/glm-4.7" }), {
      defaultModel: "ollama/llama3.2",
    } as import("../src/util/config").Config);
    expect(m).toBe("ollama/glm-4.7");
  });

  it("falls back to config defaultModel", () => {
    const m = resolveTitleModel(sampleSession(), {
      defaultModel: "openrouter/anthropic/claude-sonnet-4.5",
    } as import("../src/util/config").Config);
    expect(m).toBe("openrouter/anthropic/claude-sonnet-4.5");
  });
});

describe("enrichSessionTitles integration", () => {
  let projectID: string;

  beforeEach(() => {
    paths.home = mkdtempSync(path.join(tmpdir(), "impulse-enrich-"));
    paths.legacy = mkdtempSync(path.join(tmpdir(), "impulse-enrich-legacy-"));
    projectID = getProjectID(paths.home);
    generateTitleMock.mockReset();
    generateTitleMock.mockImplementation(() =>
      Promise.resolve("File system exploration")
    );
  });

  afterEach(() => {
    if (paths.home) rmSync(paths.home, { recursive: true, force: true });
    if (paths.legacy) rmSync(paths.legacy, { recursive: true, force: true });
  });

  it("writes headerTitle to disk", async () => {
    const base = sampleSession({ projectID, model: "ollama/glm-4.7" });
    await SessionStoreInstance.create({
      ...base,
      id: "sess_write_test",
    });

    const result = await enrichSessionTitles({
      projectScope: "all",
      delayMs: 0,
    });

    expect(result.updated).toBe(1);
    const filePath = path.join(
      paths.home,
      "sessions",
      projectID,
      "sess_write_test.json"
    );
    const onDisk = JSON.parse(readFileSync(filePath, "utf-8")) as Session;
    expect(onDisk.headerTitle).toBe("File system exploration");
  });

  it("is idempotent on second run", async () => {
    const base = sampleSession({ projectID, headerTitle: "Existing" });
    await SessionStoreInstance.create({
      ...base,
      id: "sess_skip_test",
    });

    const result = await enrichSessionTitles({
      projectScope: "all",
      delayMs: 0,
    });

    expect(result.updated).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it("dry-run does not write", async () => {
    await SessionStoreInstance.create({
      ...sampleSession({ projectID }),
      id: "sess_dry_test",
    });

    const result = await enrichSessionTitles({
      projectScope: "all",
      dryRun: true,
      delayMs: 0,
    });

    expect(result.dryRun).toBe(true);
    expect(result.updated).toBe(0);
    const filePath = path.join(
      paths.home,
      "sessions",
      projectID,
      "sess_dry_test.json"
    );
    const onDisk = JSON.parse(readFileSync(filePath, "utf-8")) as Session;
    expect(onDisk.headerTitle).toBeUndefined();
  });
});
