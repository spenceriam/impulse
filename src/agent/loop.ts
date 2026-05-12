/**
 * Agent Loop — core agentic execution engine.
 *
 * Drives the stream → parse → tool-execute → continue cycle.
 * Fully decoupled from rendering: emits typed events that the CLI
 * renderer subscribes to.
 *
 * Features:
 *  - Streaming tokens + thinking/reasoning blocks
 *  - Tool call accumulation across stream chunks
 *  - Centralized permission flow via the permission module
 *  - Auto-compaction at 85% context fill
 *  - Advisor model consultation (on-demand + auto-stuck detection)
 *  - Abort via AbortController
 */

import type { ChatMessage, ToolDefinition } from "../api/types";
import type { StreamCompletionOptions } from "../api/provider";
import { getProviderManager } from "../api/manager";
import { load as loadConfig } from "../util/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Debug logging ────────────────────────────────────────────────────────────
const debugLogPath = path.join(os.homedir(), ".config", "impulse", "debug.log");

function debugLog(msg: string): void {
  // Always log to file for thinking tokens (can be toggled via /debug command)
  const timestamp = new Date().toISOString();
  fs.appendFileSync(debugLogPath, `[${timestamp}] [loop] ${msg}\n`);
}
import { Tool } from "../tools/registry";
import { type Message } from "../session/store";
import { SessionManager } from "../session/manager";
import { CompactManager, COMPACT_TRIGGER_THRESHOLD } from "../session/compact";
import { generateSystemPrompt } from "../agent/prompts";
import { setCurrentMode } from "../tools/mode-state";
import type { Mode } from "../constants";

// ─────────────────────────────────────────────────────────────────────────────
// Event types emitted by the loop to the renderer
// ─────────────────────────────────────────────────────────────────────────────

export interface LoopEvents {
  /** Turn is about to start (request being sent) */
  onTurnStart(): void;
  /** Streaming text token from the worker model */
  onToken(text: string): void;
  /** Streaming thinking/reasoning token from the worker model */
  onThinking(text: string): void;
  /** Advisor model is being consulted — streams its response */
  onAdvisorStart(model: string): void;
  onAdvisorToken(text: string): void;
  /** Called when advisor finishes — passes the full response text as summary */
  onAdvisorEnd(summary: string): void;
  /** Tool call lifecycle */
  onToolStart(id: string, name: string, args: Record<string, unknown>): void;
  onToolEnd(
    id: string,
    name: string,
    result: { success: boolean; output: string; metadata?: Record<string, unknown> },
    durationMs: number
  ): void;
  /** Context compaction */
  onCompacting(): void;
  onCompacted(removedCount: number, summary: string): void;
  /** Turn complete */
  onTurnEnd(usage: {
    inputTokens: number;
    outputTokens: number;
    contextPct: number;
    tokensPerSecond: number;
    durationMs: number;
  }): void;
  /** Fatal error */
  onError(err: Error): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PartialToolCall {
  index: number;
  id: string;
  name: string;
  argumentsJson: string;
}

function buildChatMessages(sessionMessages: Message[], systemPrompt: string): ChatMessage[] {
  const result: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of sessionMessages) {
    if (m.role === "system") continue; // system prompt already added above
    if (m.role === "user" || m.role === "assistant") {
      const msg: ChatMessage = { role: m.role, content: m.content ?? "" };
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id ?? `call_${tc.tool}`,
          type: "function" as const,
          function: { name: tc.tool, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      result.push(msg);
    } else if (m.role === "tool" as string) {
      // Tool result messages — stored as role:"tool" in session
      const toolMsg = m as unknown as { role: "tool"; content: string; tool_call_id: string };
      result.push({ role: "tool", content: toolMsg.content, tool_call_id: toolMsg.tool_call_id });
    }
  }
  return result;
}

function estimateTokens(messages: ChatMessage[]): number {
  // Rough estimate: 1 token ≈ 4 chars
  return Math.ceil(JSON.stringify(messages).length / 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentLoop
// ─────────────────────────────────────────────────────────────────────────────

export class AgentLoop {
  private abortController: AbortController | null = null;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  async run(userMessage: string, mode: Mode, events: LoopEvents): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const config = await loadConfig();
      const manager = await getProviderManager();
      const model = config.defaultModel;

      // Sync mode to tool-state so mode-restricted tools work
      setCurrentMode(mode);

      // ── Session setup ──────────────────────────────────────────────────────
      let session = SessionManager.getCurrentSession();
      if (!session) {
        session = await SessionManager.createNew();
      }

      // Add user message to session
      const userMsg: Message = {
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      };
      await SessionManager.addMessage(userMsg);
      session = SessionManager.getCurrentSession()!;

      // ── Tool definitions ───────────────────────────────────────────────────
      const toolDefs: ToolDefinition[] = Tool.getAPIDefinitionsForMode(mode);

      // Add consult_advisor tool if advisor model is configured
      if (config.advisorModel) {
        toolDefs.push({
          type: "function",
          function: {
            name: "consult_advisor",
            description:
              "Ask the advisor model for strategic guidance when you are stuck, " +
              "unsure of approach, or need a second opinion before taking a significant action.",
            parameters: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description: "Specific question or situation to get guidance on",
                },
                context: {
                  type: "string",
                  description: "Brief summary of what you have tried and what failed",
                },
              },
              required: ["question"],
            },
          },
        });
      }

      // ── Agentic loop ───────────────────────────────────────────────────────
      let continueLoop = true;
      let outputTokens = 0;
      const contextWindow = session.context_window || 200000;
      const turnStart = Date.now();
      let firstGenerationTime: number | null = null;
      let lastGeneratedAt: number | null = null;
      let activeStreamingMs = 0;
      let estimatedGeneratedTokens = 0;
      let lastSystemPrompt = "";

      const noteGeneratedChunk = (text: string): void => {
        const now = Date.now();
        if (firstGenerationTime === null) firstGenerationTime = now;
        estimatedGeneratedTokens += Math.max(1, Math.ceil(text.length / 4));
        if (lastGeneratedAt !== null) {
          activeStreamingMs += Math.min(now - lastGeneratedAt, 250);
        }
        lastGeneratedAt = now;
      };

      events.onTurnStart();

      while (continueLoop && !signal.aborted) {
        // Check compaction before each iteration
        const currentMessages = (SessionManager.getCurrentSession()?.messages ?? []);
        const estimatedTokens = estimateTokens(buildChatMessages(currentMessages, ""));
        const contextPct = estimatedTokens / contextWindow;

        if (contextPct >= COMPACT_TRIGGER_THRESHOLD) {
          events.onCompacting();
          const result = await CompactManager.compact(session.id);
          if (result.compacted) {
            events.onCompacted(result.removedCount, result.summary);
          }
          // Refresh session after compaction
          session = SessionManager.getCurrentSession()!;
        }

        // Build messages for API call
        const freshMessages = (SessionManager.getCurrentSession()?.messages ?? []);
        const systemPrompt = await generateSystemPrompt(mode, undefined, config);
        lastSystemPrompt = systemPrompt;
        const chatMessages = buildChatMessages(freshMessages, systemPrompt);

        // ── Stream response ─────────────────────────────────────────────────
        const streamOptions: StreamCompletionOptions = {
          model,
          messages: chatMessages,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
          stream: true,
          signal,
          max_tokens: config.maxOutputTokens,
          ...(config.thinking ? { thinking: { type: "enabled" as const, clear_thinking: false } } : {}),
          // New unified reasoning level — providers map this to their own params
          reasoningLevel: config.reasoningLevel ?? (config.thinking ? "medium" : "off"),
        };

        const partialToolCalls = new Map<number, PartialToolCall>();
        let accumulatedText = "";
        let accumulatedThinking = "";
        let finishReason: string | null = null;
        let chunkOutputTokens = 0;

        for await (const chunk of manager.stream(streamOptions)) {
          if (signal.aborted) break;

          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;
          finishReason = choice.finish_reason ?? finishReason;

          // Text token
          if (delta.content) {
            noteGeneratedChunk(delta.content);
            accumulatedText += delta.content;
            events.onToken(delta.content);
          }

          // Thinking token
          if (delta.reasoning_content) {
            noteGeneratedChunk(delta.reasoning_content);
            accumulatedThinking += delta.reasoning_content;
            events.onThinking(delta.reasoning_content);
            debugLog(`thinking: ${delta.reasoning_content.length} chars`);
          }

          // Tool call fragments
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!partialToolCalls.has(idx)) {
                // First chunk for this tool call — initialise from it, don't append
                partialToolCalls.set(idx, {
                  index: idx,
                  id: tc.id ?? `call_${idx}_${Date.now()}`,
                  name: tc.function?.name ?? "",
                  argumentsJson: tc.function?.arguments ?? "",
                });
              } else {
                // Subsequent chunks — append incremental fragments only
                const partial = partialToolCalls.get(idx)!;
                if (tc.id) partial.id = tc.id;
                if (tc.function?.name) partial.name += tc.function.name;
                if (tc.function?.arguments) partial.argumentsJson += tc.function.arguments;
              }
            }
          }

          // Token usage
          if (chunk.usage) {
            chunkOutputTokens = chunk.usage.completion_tokens ?? 0;
          }
        }

        if (signal.aborted) break;

        outputTokens += chunkOutputTokens;

        // ── Persist assistant message ───────────────────────────────────────
        const toolCalls = Array.from(partialToolCalls.values());
        const assistantMsg: Message = {
          role: "assistant",
          content: accumulatedText,
          ...(accumulatedThinking ? { reasoning_content: accumulatedThinking } : {}),
          timestamp: new Date().toISOString(),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                tool: tc.name,
                arguments: (() => {
                  try { return JSON.parse(tc.argumentsJson) as Record<string, unknown>; }
                  catch { return { raw: tc.argumentsJson } as Record<string, unknown>; }
                })(),
                timestamp: new Date().toISOString(),
              })) } : {}),
        };
        await SessionManager.addMessage(assistantMsg);

        // ── No tool calls → done ────────────────────────────────────────────
        if (finishReason !== "tool_calls" || toolCalls.length === 0) {
          continueLoop = false;
          break;
        }

        // ── Execute tool calls ──────────────────────────────────────────────
        let allSucceeded = true;

        for (const tc of toolCalls) {
          if (signal.aborted) break;

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.argumentsJson);
          } catch {
            args = { raw: tc.argumentsJson };
          }

          // Handle advisor tool specially
          if (tc.name === "consult_advisor" && config.advisorModel) {
            const toolStart = Date.now();
            events.onToolStart(tc.id, "consult_advisor", args);

            const advisorResult = await this.runAdvisor(
              config.advisorModel,
              chatMessages,
              String(args["question"] ?? ""),
              String(args["context"] ?? ""),
              events,
              signal
            );

            events.onToolEnd(
              tc.id,
              "consult_advisor",
              { success: true, output: advisorResult },
              Date.now() - toolStart
            );

            // Add tool result to session
            const advisorToolMsg = {
              role: "tool" as const,
              content: advisorResult,
              tool_call_id: tc.id,
              timestamp: new Date().toISOString(),
            };
            await SessionManager.addMessage(advisorToolMsg as unknown as Message);
            continue;
          }

          // Execute — individual tools are responsible for invoking the
          // centralized permission module when approval is required.
          const toolStart = Date.now();
          events.onToolStart(tc.id, tc.name, args);

          const result = await Tool.execute(tc.name, args);
          const durationMs = Date.now() - toolStart;

          if (!result.success) {
            this.consecutiveFailures++;
            allSucceeded = false;
          } else {
            this.consecutiveFailures = 0;
          }

          events.onToolEnd(tc.id, tc.name, result, durationMs);

          // Add tool result to session
          const toolResultMsg = {
            role: "tool" as const,
            content: result.output,
            tool_call_id: tc.id,
            timestamp: new Date().toISOString(),
          };
          await SessionManager.addMessage(toolResultMsg as unknown as Message);

          // Auto-stuck: trigger advisor if too many consecutive failures
          if (
            this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES &&
            config.advisorModel &&
            !signal.aborted
          ) {
            this.consecutiveFailures = 0;
            const stuckQuestion = `I've failed ${this.MAX_CONSECUTIVE_FAILURES} times in a row. The last error was: ${result.output}. What should I do differently?`;
            events.onAdvisorStart(config.advisorModel);
            const guidance = await this.runAdvisor(
              config.advisorModel,
              chatMessages,
              stuckQuestion,
              "",
              events,
              signal
            );
            // onAdvisorEnd already called inside runAdvisor
            void guidance; // used in injection below

            // Inject advisor guidance as a system message
            const advisorInjection: Message = {
              role: "assistant",
              content: `[Advisor guidance received: ${guidance}]`,
              timestamp: new Date().toISOString(),
            };
            await SessionManager.addMessage(advisorInjection);
          }
        }

        if (!allSucceeded && toolCalls.length > 0) {
          // Keep looping to let the model handle the errors
        }

        session = SessionManager.getCurrentSession()!;
      }

      if (signal.aborted) {
        return;
      }

      // ── Final usage report ─────────────────────────────────────────────────
      const durationMs = Date.now() - turnStart;
      const generationMs = activeStreamingMs > 0
        ? activeStreamingMs
        : firstGenerationTime !== null
          ? Math.max(120, Date.now() - firstGenerationTime)
          : 0;
      const tokensPerSecond = generationMs > 0
        ? Math.round((estimatedGeneratedTokens / generationMs) * 1000)
        : 0;
      const finalMessages = SessionManager.getCurrentSession()?.messages ?? [];
      const estimatedContextTokens = estimateTokens(buildChatMessages(finalMessages, lastSystemPrompt));
      events.onTurnEnd({
        inputTokens: estimatedContextTokens,
        outputTokens,
        contextPct: Math.min(1, estimatedContextTokens / contextWindow),
        tokensPerSecond,
        durationMs,
      });

    } catch (err) {
      if (err instanceof Error && err.message.includes("aborted")) return;
      events.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }

  // ─── Advisor invocation ─────────────────────────────────────────────────

  private async runAdvisor(
    advisorModel: string,
    workerContext: ChatMessage[],
    question: string,
    context: string,
    events: LoopEvents,
    signal: AbortSignal
  ): Promise<string> {
    try {
      const manager = await getProviderManager();
      events.onAdvisorStart(advisorModel);

      const advisorMessages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are a strategic advisor for an AI coding agent. " +
            "Review the worker's context and question, then provide concise, actionable guidance. " +
            "Focus on approach and strategy — not implementation details. " +
            "Keep your response under 300 words.",
        },
        {
          role: "user",
          content:
            `Worker context summary (last ${Math.min(6, workerContext.length)} messages):\n` +
            workerContext
              .slice(-6)
              .map((m) => `[${m.role}]: ${typeof m.content === "string" ? m.content.slice(0, 400) : ""}`)
              .join("\n") +
            `\n\nQuestion: ${question}` +
            (context ? `\n\nContext: ${context}` : ""),
        },
      ];

      let advisorResponse = "";
      for await (const chunk of manager.stream({
        model: advisorModel,
        messages: advisorMessages,
        stream: true,
        signal,
      })) {
        if (signal.aborted) break;
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) {
          advisorResponse += text;
          events.onAdvisorToken(text);
        }
      }

      events.onAdvisorEnd(advisorResponse || "(no advisor response)");
      return advisorResponse || "(no advisor response)";
    } catch (err) {
      const errMsg = `(advisor error: ${err instanceof Error ? err.message : String(err)})`;
      events.onAdvisorEnd(errMsg);
      return errMsg;
    }
  }

}
