import { describe, expect, test } from "bun:test";
import type { LoopEvents } from "../src/agent/loop.js";
import { TuiRuntimeController } from "../src/runtime/tui-controller.js";

function noOpEvents(overrides: Partial<LoopEvents> = {}): LoopEvents {
  return {
    onTurnStart() {},
    onToken() {},
    onThinking() {},
    onAdvisorStart() {},
    onAdvisorToken() {},
    onAdvisorEnd() {},
    onToolStart() {},
    onToolEnd() {},
    onCompacting() {},
    onCompacted() {},
    onTurnEnd() {},
    onHardCutoff() {},
    onError() {},
    ...overrides,
  };
}

describe("TUI runtime compatibility adapter", () => {
  test("renderer-shaped turns use RuntimeSession mode and cancellation", async () => {
    let observedMode = "";
    let observedMessage = "";
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let aborted = false;
    const fakeLoop = {
      setImages() {},
      setSteer() {},
      abort() { aborted = true; release(); },
      async run(message: string, mode: "ASK" | "AGENT", events: LoopEvents) {
        observedMessage = message;
        observedMode = mode;
        events.onTurnStart();
        events.onToken("hello");
        await waiting;
        if (aborted) events.onAbort?.();
        else events.onTurnEnd({
          inputTokens: 1,
          outputTokens: 1,
          contextPct: 0.01,
          tokensPerSecond: 1,
          durationMs: 1,
          contextTokenSource: "estimated",
        });
      },
    };
    const controller = new TuiRuntimeController({ cwd: process.cwd(), loop: fakeLoop });
    const tokens: string[] = [];
    const turn = controller.run("test", "AGENT", noOpEvents({
      onToken: (text) => tokens.push(text),
    }));
    for (let i = 0; i < 10 && observedMessage === ""; i++) await Promise.resolve();
    expect(controller.snapshot().mode).toBe("AGENT");
    expect(observedMode).toBe("AGENT");
    expect(observedMessage).toBe("test");
    expect(tokens).toEqual(["hello"]);
    controller.abort();
    await turn;
    expect(aborted).toBe(true);
    expect(controller.snapshot().turnActive).toBe(false);
  });
});
