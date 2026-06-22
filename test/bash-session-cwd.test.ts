import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import path from "path";
import { bashTool } from "../src/tools/bash.js";

const root = path.join(process.cwd(), `.tmp-bash-session-${Date.now()}`);
const child = path.join(root, "child");
const other = path.join(root, "other");

async function run(
  command: string,
  session: string,
  options: { resetSession?: boolean; workdir?: string | null } = {}
) {
  return bashTool.handler({
    command,
    description: "test bash session cwd tracking",
    ...(options.workdir === null ? {} : { workdir: options.workdir ?? root }),
    session,
    timeout: 10_000,
    ...(options.resetSession ? { resetSession: true } : {}),
  });
}

describe("bash named session cwd tracking", () => {
  beforeAll(() => {
    mkdirSync(child, { recursive: true });
    mkdirSync(other, { recursive: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("chained cd parses only the directory target and updates cwd on later command failure", async () => {
    const result = await run("cd child; exit 7", "session-failed-chain", { resetSession: true });

    expect(result.success).toBe(false);
    expect(result.metadata?.sessionCwd).toBe(child);
  });

  test("chained cd updates cwd on successful command", async () => {
    const result = await run("cd child; echo ok", "session-successful-chain", { resetSession: true });

    expect(result.success).toBe(true);
    expect(result.metadata?.sessionCwd).toBe(child);
  });

  test("missing cd target does not update stored cwd", async () => {
    const session = "session-missing-target";
    await run("cd other", session, { resetSession: true });

    const result = await run("cd missing-dir; echo after", session, { workdir: null });

    expect(result.metadata?.sessionCwd).toBe(other);
  });

  test("lone cd still updates cwd", async () => {
    const result = await run("cd child", "session-lone-cd", { resetSession: true });

    expect(result.success).toBe(true);
    expect(result.metadata?.sessionCwd).toBe(child);
  });

  test("distinct named sessions keep separate cwd state", async () => {
    const first = await run("cd child", "session-one", { resetSession: true });
    const second = await run("cd other", "session-two", { resetSession: true });

    expect(first.metadata?.sessionCwd).toBe(child);
    expect(second.metadata?.sessionCwd).toBe(other);
  });
});
