import { isAbsolute, resolve } from "path";
import { AgentLoop, type LoopEvents } from "../agent/loop.js";
import type { PromptSegment } from "../cli/prompt-input.js";
import { SessionManagerImpl } from "../session/manager.js";
import { runWithSessionManager } from "../session/runtime-context.js";
import type {
  RuntimePlanEntry,
  RuntimeToolKind,
  RuntimeToolLocation,
  RuntimeTurnDriver,
  RuntimeTurnDriverContext,
  RuntimeTurnResult,
} from "./types.js";

interface SessionLoopState {
  loop: AgentLoop;
  manager: SessionManagerImpl;
  ready: Promise<void>;
}

function toolKind(name: string): RuntimeToolKind {
  if (["file_read", "ls"].includes(name)) return "read";
  if (["glob", "grep", "semantic_search"].includes(name)) return "search";
  if (["file_write", "file_edit", "skill_write", "install_skill"].includes(name)) return "edit";
  if (["skill_remove"].includes(name)) return "delete";
  if (["bash", "project_validate"].includes(name)) return "execute";
  if (["web_fetch", "web_search", "github_issue"].includes(name)) return "fetch";
  if (name === "set_mode") return "switch-mode";
  if (["task", "todo_read", "todo_write", "consult_advisor"].includes(name)) return "think";
  return "other";
}

function toolLocations(
  args: Record<string, unknown>,
  cwd: string
): RuntimeToolLocation[] | undefined {
  for (const key of ["path", "filePath", "file", "workdir"]) {
    const value = args[key];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    return [{ path: isAbsolute(value) ? resolve(value) : resolve(cwd, value) }];
  }
  return undefined;
}

function planEntries(metadata: Record<string, unknown> | undefined): RuntimePlanEntry[] | undefined {
  if (metadata?.["type"] !== "todo" || !Array.isArray(metadata["todos"])) return undefined;
  return metadata["todos"].flatMap((entry): RuntimePlanEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const todo = entry as Record<string, unknown>;
    if (
      typeof todo["id"] !== "string" ||
      typeof todo["content"] !== "string" ||
      !["high", "medium", "low"].includes(String(todo["priority"])) ||
      !["pending", "in_progress", "completed", "cancelled"].includes(String(todo["status"]))
    ) return [];
    return [{
      id: todo["id"],
      content: todo["content"],
      priority: todo["priority"] as RuntimePlanEntry["priority"],
      status: todo["status"] === "in_progress"
        ? "in-progress"
        : todo["status"] === "cancelled"
          ? "completed"
          : todo["status"] as RuntimePlanEntry["status"],
    }];
  });
}

function promptSegments(context: RuntimeTurnDriverContext): PromptSegment[] {
  let imageIndex = 0;
  return context.prompt.content.flatMap((part): PromptSegment[] => {
    switch (part.type) {
      case "text":
        return [{ kind: "text", value: part.text }];
      case "image": {
        imageIndex++;
        const uri = part.uri ?? `data:${part.mimeType};base64,${part.data}`;
        return [{ kind: "image", index: imageIndex, display: `[Image #${imageIndex}]`, uri }];
      }
      case "resource":
        return [{
          kind: "text",
          value: part.text ?? `[Resource: ${part.uri}]`,
        }];
    }
  });
}

export class AgentLoopTurnDriver implements RuntimeTurnDriver {
  private readonly states = new Map<string, SessionLoopState>();

  async run(context: RuntimeTurnDriverContext): Promise<RuntimeTurnResult> {
    const state = await this.stateFor(context);
    let result: RuntimeTurnResult = { stopReason: "end-turn" };
    let turnError: Error | undefined;
    let thinkingSeen = false;
    const onExternalAbort = () => state.loop.abort();
    context.signal.addEventListener("abort", onExternalAbort, { once: true });

    const events: LoopEvents = {
      onTurnStart() {},
      onToken: (text) => context.emit({ type: "assistant-token", text }),
      onThinking: (text) => {
        thinkingSeen = true;
        if (context.session.config.thinkingDisplay === "full") {
          context.emit({ type: "thinking-token", text });
        }
      },
      onAdvisorStart: (model) => context.emit({ type: "info", message: `Consulting advisor ${model}` }),
      onAdvisorToken: (text) => {
        if (context.session.config.thinkingDisplay === "full") {
          context.emit({ type: "thinking-token", text });
        }
      },
      onAdvisorEnd: () => {},
      onPlanApproval: async (input) => {
        const answer = await context.requestQuestion({
          prompt: `${input.summary}\n\nHow should Impulse continue with this plan?`,
          choices: [
            { id: "preview", label: "Preview safely" },
            { id: "agent", label: "Switch to AGENT" },
            { id: "revise", label: "Revise" },
            { id: "stay", label: "Stay in ASK" },
          ],
        });
        if (answer.outcome !== "answered") return "stay";
        const value = answer.values[0];
        return value === "preview" || value === "agent" || value === "revise" ? value : "stay";
      },
      onToolStart: (id, name, args) => {
        const locations = toolLocations(args, context.session.cwd);
        context.emit({
          type: "tool-start",
          id,
          name,
          title: `${name}${typeof args["path"] === "string" ? ` ${args["path"]}` : ""}`,
          kind: toolKind(name),
          ...(locations ? { locations } : {}),
          rawInput: args,
        });
      },
      onToolEnd: (id, name, toolResult, durationMs) => {
        context.emit({
          type: "tool-end",
          id,
          name,
          success: toolResult.success,
          output: toolResult.output,
          durationMs,
          rawOutput: toolResult,
        });
        const entries = planEntries(toolResult.metadata);
        if (entries) context.emit({ type: "plan", id: "session-todos", entries });
      },
      onSubagentTaskStatus: (id, status) => context.emit({
        type: "tool-update",
        id,
        status: status === "running" ? "in-progress" : status === "done" ? "completed" : "pending",
      }),
      onTaskBatchPermission: async (input) => {
        const decision = await context.requestPermission({
          toolCallId: `task-batch:${context.session.id}`,
          title: `Run ${input.count} general subagents`,
          kind: "think",
          options: [
            { id: "approve", label: "Run all", kind: "allow-once" },
            { id: "deny", label: "Do not run", kind: "reject-once" },
          ],
          rawInput: input,
        });
        if (decision.outcome === "cancelled") return { action: "cancel" };
        return decision.optionId === "approve" ? { action: "approve" } : { action: "deny" };
      },
      onLoopCheckin: async (input) => {
        const answer = await context.requestQuestion({
          prompt: `Loop check-in at iteration ${input.iteration}: ${input.reason}`,
          choices: [
            { id: "continue", label: "Continue" },
            { id: "finalize", label: "Finalize" },
            { id: "stop", label: "Stop" },
          ],
        });
        if (answer.outcome !== "answered") return "stop";
        const value = answer.values[0];
        return value === "continue" || value === "finalize" ? value : "stop";
      },
      onCompacting: () => context.emit({ type: "info", message: "Compacting conversation context" }),
      onCompacted: (removedCount) => context.emit({ type: "info", message: `Compacted ${removedCount} messages` }),
      onTurnEnd: (usage) => {
        if (thinkingSeen && context.session.config.thinkingDisplay === "summary") {
          context.emit({ type: "thinking-token", text: "Reasoning completed." });
        }
        const contextWindow = state.manager.getCurrentSession()?.context_window ?? 200_000;
        const runtimeUsage = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          contextTokens: usage.inputTokens,
          contextWindow,
        };
        context.emit({ type: "usage", usage: runtimeUsage });
        result = { stopReason: "end-turn", usage: runtimeUsage };
      },
      onAbort: () => { result = { stopReason: "cancelled" }; },
      onHardCutoff: (contextTokens) => {
        context.emit({ type: "info", message: `Context limit reached at ${contextTokens} tokens` });
        result = { stopReason: "max-tokens" };
      },
      onError: (error) => { turnError = error; },
    };

    try {
      await runWithSessionManager(state.manager, () => state.loop.run(
        context.prompt.text,
        context.session.mode,
        events,
        {
          displayMessage: context.prompt.text,
          segments: promptSegments(context),
        }
      ));
      if (turnError) throw turnError;
      return context.signal.aborted ? { stopReason: "cancelled" } : result;
    } finally {
      context.signal.removeEventListener("abort", onExternalAbort);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) return;
    await state.ready;
    state.loop.abort();
    await runWithSessionManager(state.manager, async () => {
      if (state.manager.getCurrentSession()) await state.manager.exitCurrent();
    });
    this.states.delete(sessionId);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.states.keys()].map((id) => this.closeSession(id)));
  }

  private async stateFor(context: RuntimeTurnDriverContext): Promise<SessionLoopState> {
    const existing = this.states.get(context.session.id);
    if (existing) {
      await existing.ready;
      existing.manager.setOptions({
        directory: context.session.cwd,
        defaultMode: context.session.mode,
        defaultModel: context.session.config.workerModel ?? "",
      });
      return existing;
    }
    const manager = SessionManagerImpl.create({
        directory: context.session.cwd,
        defaultMode: context.session.mode,
        defaultModel: context.session.config.workerModel ?? "",
        writeActiveMarker: false,
      });
    const state: SessionLoopState = {
      loop: new AgentLoop(),
      manager,
      ready: Promise.resolve(),
    };
    state.ready = runWithSessionManager(manager, async () => {
      if (!manager.getCurrentSession()) {
        await manager.createNew(`ACP ${context.session.id.slice(0, 8)}`);
      }
    });
    this.states.set(context.session.id, state);
    try {
      await state.ready;
      return state;
    } catch (error) {
      if (this.states.get(context.session.id) === state) this.states.delete(context.session.id);
      throw error;
    }
  }
}
