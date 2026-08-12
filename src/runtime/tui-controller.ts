import { AgentLoop, type LoopEvents, type RunTurnOptions } from "../agent/loop.js";
import type { Mode } from "../constants.js";
import type { RuntimeConfig, RuntimeSessionSnapshot, RuntimeTurnDriver, RuntimeTurnDriverContext, RuntimeTurnResult } from "./types.js";
import { HeadlessRuntime, type RuntimeSession } from "./session.js";

type TuiLoop = Pick<AgentLoop, "abort" | "run" | "setImages" | "setSteer">;

interface PendingTuiTurn {
  events: LoopEvents;
  options?: RunTurnOptions;
}

class TuiLoopDriver implements RuntimeTurnDriver {
  private pending: PendingTuiTurn | undefined;

  constructor(readonly loop: TuiLoop) {}

  prepare(turn: PendingTuiTurn): void {
    if (this.pending) throw new Error("A TUI turn is already prepared.");
    this.pending = turn;
  }

  async run(context: RuntimeTurnDriverContext): Promise<RuntimeTurnResult> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) throw new Error("TUI runtime turn was not prepared.");
    let result: RuntimeTurnResult = { stopReason: "end-turn" };
    let turnError: Error | undefined;
    const abort = () => this.loop.abort();
    context.signal.addEventListener("abort", abort, { once: true });
    const events: LoopEvents = {
      ...pending.events,
      onTurnEnd: (usage) => {
        pending.events.onTurnEnd(usage);
        result = {
          stopReason: "end-turn",
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            contextTokens: usage.inputTokens,
            contextWindow: usage.contextPct > 0
              ? Math.max(usage.inputTokens, Math.round(usage.inputTokens / usage.contextPct))
              : Math.max(usage.inputTokens, 1),
          },
        };
      },
      onAbort: () => {
        pending.events.onAbort?.();
        result = { stopReason: "cancelled" };
      },
      onError: (error) => {
        pending.events.onError(error);
        turnError = error;
      },
    };
    try {
      await this.loop.run(
        context.prompt.text,
        context.session.mode,
        events,
        pending.options
      );
      if (turnError) throw turnError;
      return context.signal.aborted ? { stopReason: "cancelled" } : result;
    } finally {
      context.signal.removeEventListener("abort", abort);
    }
  }
}

export interface TuiRuntimeControllerOptions {
  cwd: string;
  loop?: TuiLoop;
  config?: Partial<RuntimeConfig>;
}

/** Pi-TUI compatibility edge backed by the shared RuntimeSession lifecycle. */
export class TuiRuntimeController {
  private readonly driver: TuiLoopDriver;
  private readonly runtime: HeadlessRuntime;
  private readonly session: RuntimeSession;

  constructor(options: TuiRuntimeControllerOptions) {
    this.driver = new TuiLoopDriver(options.loop ?? new AgentLoop());
    this.runtime = new HeadlessRuntime({ turnDriver: this.driver });
    this.session = this.runtime.createSession({
      cwd: options.cwd,
      ...(options.config ? { config: options.config } : {}),
      ambientExecutionContext: false,
    });
  }

  snapshot(): RuntimeSessionSnapshot {
    return this.session.snapshot();
  }

  setImages(images: Array<{ uri: string; display: string }>): void {
    this.driver.loop.setImages(images);
  }

  setSteer(text: string): void {
    this.driver.loop.setSteer(text);
  }

  abort(): void {
    this.driver.loop.abort();
    void this.session.cancel();
  }

  async run(
    userMessage: string,
    mode: Mode,
    events: LoopEvents,
    options?: RunTurnOptions
  ): Promise<void> {
    this.session.setMode(mode);
    this.driver.prepare({ events, ...(options ? { options } : {}) });
    await this.session.run({
      text: userMessage,
      content: [{ type: "text", text: userMessage }],
    });
  }

  async dispose(): Promise<void> {
    await this.runtime.dispose();
  }
}
