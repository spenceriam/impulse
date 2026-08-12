import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager } from "../src/session/manager.js";
import { createDefaultConfig } from "../src/util/config.js";

describe("ASK defaults", () => {
  let createdSessionID: string | undefined;

  afterEach(async () => {
    if (createdSessionID) await SessionManager.deleteSession(createdSessionID);
    SessionManager.setOptions({ defaultMode: "ASK" });
  });

  test("config and new sessions normalize missing and legacy defaults safely", async () => {
    expect(createDefaultConfig().defaultMode).toBe("ASK");
    expect(createDefaultConfig({ defaultMode: "WORK" }).defaultMode).toBe("AGENT");
    expect(createDefaultConfig({ defaultMode: "PLAN" }).defaultMode).toBe("ASK");
    expect(createDefaultConfig({ defaultMode: "mystery" }).defaultMode).toBe("ASK");

    SessionManager.setOptions({ defaultMode: "PLAN" });
    expect(SessionManager.getOptions().defaultMode).toBe("ASK");

    const session = await SessionManager.createNew("ask-default-test");
    createdSessionID = session.id;
    expect(session.mode).toBe("ASK");
  });
});
