import type { RuntimeTurnDriver } from "../runtime/types.js";
import { Tool } from "../tools/registry.js";

/** Deterministic injected driver used only by protocol fixtures. */
export class AcpFixtureTurnDriver implements RuntimeTurnDriver {
  async run(context: Parameters<RuntimeTurnDriver["run"]>[0]) {
    context.emit({ type: "thinking-token", text: `thinking:${context.prompt.text}` });
    context.emit({ type: "assistant-token", text: `answer:${context.prompt.text}` });
    if (context.prompt.text === "wait") {
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) resolve();
        else context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { stopReason: "cancelled" as const };
    }

    if (context.prompt.text.startsWith("mcp echo ") || context.prompt.text === "mcp misleading") {
      const toolNeedle = context.prompt.text === "mcp misleading"
        ? "misleading_read"
        : "session_echo";
      const definition = Tool.getAPIDefinitionsForMode(context.session.mode).find(
        (candidate) => candidate.function.name.includes(toolNeedle)
      );
      if (!definition) throw new Error(`Session MCP tool ${toolNeedle} was not exposed to the owning turn.`);
      const id = `fixture-mcp:${context.session.id}`;
      const input = context.prompt.text === "mcp misleading"
        ? {}
        : { text: context.prompt.text.slice("mcp echo ".length) };
      context.emit({
        type: "tool-start",
        id,
        name: definition.function.name,
        title: "Session MCP echo",
        kind: "execute",
        rawInput: input,
      });
      const started = Date.now();
      const result = await Tool.execute(definition.function.name, input, { callId: id });
      context.emit({
        type: "tool-update",
        id,
        status: result.success ? "completed" : "failed",
        output: result.output,
        rawOutput: result.metadata,
      });
      context.emit({
        type: "tool-end",
        id,
        name: definition.function.name,
        success: result.success,
        output: result.output,
        durationMs: Date.now() - started,
        rawOutput: result.metadata,
      });
      context.emit({ type: "assistant-token", text: result.output });
      return {
        stopReason: "end-turn" as const,
        usage: { inputTokens: 5, outputTokens: 3, contextTokens: 8, contextWindow: 1000 },
      };
    }

    const id = `fixture-tool:${context.session.id}`;
    context.emit({
      type: "tool-start",
      id,
      name: "bash",
      title: "Fixture tool",
      kind: "execute",
      rawInput: { command: "fixture" },
    });
    const permission = await context.requestPermission({
      toolCallId: id,
      title: "Fixture tool",
      kind: "execute",
      options: [
        { id: "allow", label: "Allow", kind: "allow-once" },
        { id: "reject", label: "Reject", kind: "reject-once" },
      ],
    });
    context.emit({
      type: "tool-end",
      id,
      name: "bash",
      success: permission.outcome === "selected",
      output: permission.outcome === "selected" ? "fixture complete" : "fixture rejected",
      durationMs: 1,
      rawOutput: permission,
    });
    context.emit({
      type: "plan",
      id: "fixture-plan",
      entries: [{ id: "fixture-step", content: "Exercise ACP", priority: "high", status: "completed" }],
    });
    return {
      stopReason: "end-turn" as const,
      usage: { inputTokens: 5, outputTokens: 3, contextTokens: 8, contextWindow: 1000 },
    };
  }

  async dispose(): Promise<void> {
    if (process.env["IMPULSE_ACP_TEST_DISPOSE_FAILURE"] === "1") {
      throw new Error("injected runtime disposal failure");
    }
  }
}
