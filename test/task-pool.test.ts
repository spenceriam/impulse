import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let active = 0;
let maxActive = 0;
const startOrder: string[] = [];
const endOrder: string[] = [];
const startTimes: number[] = [];

mock.module("../src/agent/task-runner.ts", () => ({
  executeSubagent: async (
    _type: string,
    _prompt: string,
    _description: string,
    _thoroughness: unknown,
    options: { parentToolCallId: string }
  ) => {
    startTimes.push(Date.now());
    active += 1;
    maxActive = Math.max(maxActive, active);
    startOrder.push(options.parentToolCallId);
    await Bun.sleep(30);
    active -= 1;
    endOrder.push(options.parentToolCallId);
    return {
      success: true,
      output: `ok:${options.parentToolCallId}`,
      summary: [],
      actions: [],
    };
  },
}));

const { runTaskBatch, MAX_CONCURRENT_SUBAGENTS } = await import("../src/agent/task-pool");

describe("runTaskBatch", () => {
  beforeEach(() => {
    active = 0;
    maxActive = 0;
    startOrder.length = 0;
    endOrder.length = 0;
    startTimes.length = 0;
  });

  afterEach(() => {
    active = 0;
    maxActive = 0;
  });

  test("caps concurrent sub-agents at MAX_CONCURRENT_SUBAGENTS", async () => {
    const calls = Array.from({ length: MAX_CONCURRENT_SUBAGENTS + 4 }, (_, i) => ({
      toolCallId: `task-${i}`,
      subagentType: "explore" as const,
      prompt: "find",
      description: `job ${i}`,
    }));

    const results = await runTaskBatch(calls, {
      maxConcurrent: MAX_CONCURRENT_SUBAGENTS,
      startStaggerMs: 0,
    });

    expect(results.size).toBe(MAX_CONCURRENT_SUBAGENTS + 4);
    expect(maxActive).toBeLessThanOrEqual(MAX_CONCURRENT_SUBAGENTS);
    expect(maxActive).toBeGreaterThan(1);
  });

  test("waits for all tasks before returning", async () => {
    const calls = [
      {
        toolCallId: "a",
        subagentType: "explore" as const,
        prompt: "one",
        description: "first",
      },
      {
        toolCallId: "b",
        subagentType: "explore" as const,
        prompt: "two",
        description: "second",
      },
    ];

    const results = await runTaskBatch(calls, { maxConcurrent: 2, startStaggerMs: 0 });

    expect(active).toBe(0);
    expect(endOrder).toEqual(["a", "b"]);
    expect(results.get("a")?.result.success).toBe(true);
    expect(results.get("b")?.result.success).toBe(true);
  });

  test("staggers sub-agent start times by batch index", async () => {
    const staggerMs = 50;
    const calls = [
      {
        toolCallId: "t0",
        subagentType: "explore" as const,
        prompt: "one",
        description: "first",
      },
      {
        toolCallId: "t1",
        subagentType: "explore" as const,
        prompt: "two",
        description: "second",
      },
      {
        toolCallId: "t2",
        subagentType: "explore" as const,
        prompt: "three",
        description: "third",
      },
    ];

    await runTaskBatch(calls, { maxConcurrent: 3, startStaggerMs: staggerMs });

    expect(startTimes.length).toBe(3);
    const gap01 = startTimes[1]! - startTimes[0]!;
    const gap12 = startTimes[2]! - startTimes[1]!;
    expect(gap01).toBeGreaterThanOrEqual(staggerMs - 25);
    expect(gap01).toBeLessThan(staggerMs + 80);
    expect(gap12).toBeGreaterThanOrEqual(staggerMs - 25);
    expect(gap12).toBeLessThan(staggerMs + 80);
  });

  test("fires running status after stagger delay", async () => {
    const staggerMs = 60;
    const runningAt: Record<string, number> = {};
    const calls = [
      {
        toolCallId: "a",
        subagentType: "explore" as const,
        prompt: "one",
        description: "first",
      },
      {
        toolCallId: "b",
        subagentType: "explore" as const,
        prompt: "two",
        description: "second",
      },
    ];

    const t0 = Date.now();
    await runTaskBatch(calls, {
      maxConcurrent: 2,
      startStaggerMs: staggerMs,
      onTaskStatus: (id, status) => {
        if (status === "running") runningAt[id] = Date.now();
      },
    });

    expect(runningAt["a"]).toBeDefined();
    expect(runningAt["b"]).toBeDefined();
    const gap = runningAt["b"]! - runningAt["a"]!;
    expect(gap).toBeGreaterThanOrEqual(staggerMs - 30);
    expect(runningAt["a"]! - t0).toBeLessThan(staggerMs + 50);
  });
});
