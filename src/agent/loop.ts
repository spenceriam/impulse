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
 *  - Auto-compaction at 60% context fill
 *  - Advisor model consultation (on-demand + auto-stuck detection)
 *  - Abort via AbortController
 */

import type { ChatMessage, ToolDefinition } from "../api/types";
import type { StreamCompletionOptions } from "../api/provider";
import { getProviderManager } from "../api/manager";
import { runAdvisorConsultation } from "./advisor.js";
import {
  isExperimentalAdvisorEnabled,
  load as loadConfig,
  resolveSubagentModel,
} from "../util/config";
import { buildChatMessages } from "./build-chat-messages.js";
import * as fs from "fs";
import * as path from "path";
import { Global } from "../global.js";
import { Tool } from "../tools/registry";
import { type Message } from "../session/store";
import { buildVisionTranslatePrompt } from "./vision-prompt.js";

// ── Debug logging ────────────────────────────────────────────────────────────
const debugLogPath = path.join(Global.Path.logs, "debug.log");

function debugLog(msg: string): void {
  const timestamp = new Date().toISOString();
  try {
    fs.mkdirSync(Global.Path.logs, { recursive: true });
    fs.appendFileSync(debugLogPath, `[${timestamp}] [loop] ${msg}\n`);
  } catch {
    // Non-fatal when logs dir cannot be created
  }
}
import { SessionManager } from "../session/manager";
import { generateTitle } from "../session/title-generator.js";
import { resolveTitleModel } from "../session/enrich-titles.js";
import { Bus, HeaderEvents } from "../bus/index.js";
import { CompactManager, COMPACT_TRIGGER_THRESHOLD } from "../session/compact";
import {
  ALLOW_ALL_TODO_NUDGE_MESSAGE,
  isTodoOnlyToolBatch,
  shouldInjectAllowAllTodoNudge,
} from "./allow-all-nudge.js";
import { generateSystemPrompt } from "../agent/prompts";
import { setCurrentMode } from "../tools/mode-state";
import { buildDebugInstrumentationNudge } from "./self-check.js";
import { ADVISOR_GATE_MESSAGE, shouldBlockBeforeAdvisor } from "./advisor-gate.js";
import { shouldRetryInEnglish } from "./language-guard.js";
import type { Mode } from "../constants";
import { modelSupportsVision } from "../api/providers/capabilities.js";
import type { PromptSegment } from "../cli/prompt-input.js";
import { buildUserMessageContent } from "../cli/prompt-input.js";
import {
  MAX_CONCURRENT_SUBAGENTS,
  runTaskBatch,
  type TaskCallSpec,
} from "./task-pool.js";
import {
  needsGeneralBatchPermission,
  type TaskBatchDecision,
  type TaskBatchPermissionInput,
} from "../permission/task-batch.js";
import type { ToolResult } from "../tools/registry";
import { resolveSubagentThinkingEnabled } from "./subagent-thinking.js";

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
  /** Block until user approves or declines an advisor plan (optional). */
  onPlanApproval?: (input: {
    planPath: string;
    summary: string;
    planMarkdown: string;
  }) => Promise<"proceed" | "decline">;
  /** Tool call lifecycle */
  onToolStart(id: string, name: string, args: Record<string, unknown>): void;
  onToolEnd(
    id: string,
    name: string,
    result: { success: boolean; output: string; metadata?: Record<string, unknown> },
    durationMs: number
  ): void;
  /** Per-task queue / active / done for parallel sub-agents (stagger-aware). */
  onSubagentTaskStatus?: (toolCallId: string, status: "queued" | "running" | "done") => void;
  /** Batch permission for parallel general sub-agents (one prompt per turn). */
  onTaskBatchPermission?: (
    input: TaskBatchPermissionInput
  ) => Promise<TaskBatchDecision>;
  /** Context compaction */
  onCompacting(): void;
  onCompacted(removedCount: number, summary: string, contextTokens?: number): void;
  /** Turn complete */
  onTurnEnd(usage: {
    inputTokens: number;
    outputTokens: number;
    contextPct: number;
    tokensPerSecond: number;
    durationMs: number;
    /** Set in DEBUG mode when [IMPULSE_DEBUG] markers remain in edited files */
    debugInstrumentationNudge?: string;
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

function estimateTokens(value: unknown): number {
  // Rough estimate: 1 token ≈ 4 chars
  return Math.ceil(JSON.stringify(value).length / 4);
}

function estimateRequestTokens(messages: ChatMessage[], tools: ToolDefinition[]): number {
  return estimateTokens({
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  });
}

export interface RunTurnOptions {
  /** Shown in chat UI (paste tokens preserved) */
  displayMessage?: string;
  /** Ordered segments for multimodal / vision_translate ordering */
  segments?: PromptSegment[];
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentLoop
// ─────────────────────────────────────────────────────────────────────────────

export class AgentLoop {
  private abortController: AbortController | null = null;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private pendingImages: Array<{ uri: string; display: string }> = [];
  private pendingUserRequest = "";
  /** Injected before the next model call in the same turn (latest wins). */
  private pendingSteer: string | null = null;

  /** Images to translate before next turn (uri + display label for tool UI). */
  setImages(images: Array<{ uri: string; display: string }>): void {
    this.pendingImages = images;
  }

  /** Redirect current turn at the next tool-loop boundary. */
  setSteer(text: string): void {
    this.pendingSteer = text.trim();
  }

  private async flushTurnInjections(): Promise<void> {
    if (this.pendingSteer) {
      const note = this.pendingSteer;
      this.pendingSteer = null;
      await SessionManager.addMessage({
        role: "user",
        content: `Steering note (apply before your next action): ${note}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async run(
    userMessage: string,
    mode: Mode,
    events: LoopEvents,
    turnOptions?: RunTurnOptions
  ): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const config = await loadConfig();
      const manager = await getProviderManager();

      // Sync mode to tool-state so mode-restricted tools work
      setCurrentMode(mode);

      // ── Session setup ──────────────────────────────────────────────────────
      let session = SessionManager.getCurrentSession();
      if (!session) {
        session = await SessionManager.createNew();
      }

      const model =
        session.model?.trim() ||
        config.defaultModel?.trim() ||
        "";

      const displayMessage = turnOptions?.displayMessage ?? userMessage;
      this.pendingUserRequest = displayMessage;
      const segments = turnOptions?.segments;
      const nativeVision = modelSupportsVision(model);

      const apiContent: Message["apiContent"] =
        segments && segments.length > 0
          ? (buildUserMessageContent(segments, nativeVision) as Message["apiContent"])
          : userMessage;

      const orderedImages =
        segments && segments.length > 0
          ? segments
              .filter((s): s is Extract<PromptSegment, { kind: "image" }> => s.kind === "image")
              .sort((a, b) => a.index - b.index)
              .map((s) => ({ uri: s.uri, display: s.display }))
          : [...this.pendingImages];

      const hasTextPaste = segments?.some((s) => s.kind === "paste") ?? false;
      const transcriptContent =
        hasTextPaste && typeof apiContent === "string" ? apiContent : displayMessage;

      const userMsg: Message = {
        role: "user",
        content: transcriptContent,
        apiContent,
        timestamp: new Date().toISOString(),
      };
      await SessionManager.addMessage(userMsg);
      session = SessionManager.getCurrentSession()!;

      if (orderedImages.length > 0 && config.visionMode) {
        this.pendingImages = orderedImages;
        await this.translateImages(config, events, signal, this.pendingUserRequest);
      }
      this.pendingImages = [];

      // ── Tool definitions ───────────────────────────────────────────────────
      const toolDefs: ToolDefinition[] = Tool.getAPIDefinitionsForMode(mode);

      // Add consult_advisor tool if experimental advisor is enabled
      if (
        config.advisorModel &&
        config.advisorMode &&
        isExperimentalAdvisorEnabled(config)
      ) {
        toolDefs.push({
          type: "function",
          function: {
            name: "consult_advisor",
            description:
              "Consult the strategic advisor before mutating work. Include an **Executor draft** in context (your approach). " +
              "Returns plan_markdown in the tool result — do NOT file_read the plan path. " +
              "MUST be called before file writes, edits, non-readonly bash, or subagent launches.",
            parameters: {
              type: "object",
              properties: {
                topic: {
                  type: "string",
                  description: "Brief topic for the plan filename (3-8 words, e.g. 'refactor-auth-module')",
                },
                context: {
                  type: "string",
                  description:
                    "Full context plus **Executor draft**: your reasoning, proposed approach, and what you need from the advisor",
                },
                type: {
                  type: "string",
                  enum: ["plan", "advisory"],
                  description: "'plan' for new work / greenfield builds. 'advisory' for course corrections / error recovery",
                },
              },
              required: ["topic", "context"],
            },
          },
        });
      }

      // ── Agentic loop ───────────────────────────────────────────────────────
      let continueLoop = true;
      let outputTokens = 0;
      const getContextWindow = (): number =>
        SessionManager.getCurrentSession()?.context_window || session?.context_window || 200000;
      const turnStart = Date.now();
      let firstGenerationTime: number | null = null;
      let lastGeneratedAt: number | null = null;
      let activeStreamingMs = 0;
      let estimatedGeneratedTokens = 0;
      let lastSystemPrompt = "";
      let latestPromptTokens: number | undefined;
      let latestCompletionTokens = 0;
      let languageRetryUsed = false;
      let consecutiveTodoOnlyRounds = 0;
      let allowAllTodoNudgeUsed = false;
      let lastUnproductiveCompact:
        | { tokens: number; messageCount: number }
        | undefined;
      const debugEditedFiles = new Set<string>();

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
        await this.flushTurnInjections();

        const currentMessages = (SessionManager.getCurrentSession()?.messages ?? []);
        const systemPrompt = await generateSystemPrompt(mode, undefined, config);
        lastSystemPrompt = systemPrompt;
        let chatMessages = buildChatMessages(currentMessages, systemPrompt);

        // Check compaction before each iteration using the same request shape
        // sent to the provider: system prompt, history, preserved reasoning,
        // tool calls/results, and tool definitions.
        const estimatedTokens = estimateRequestTokens(chatMessages, toolDefs);
        const contextWindow = getContextWindow();
        const contextPct = estimatedTokens / contextWindow;

        const shouldTryCompact =
          contextPct >= COMPACT_TRIGGER_THRESHOLD &&
          (
            lastUnproductiveCompact === undefined ||
            currentMessages.length > lastUnproductiveCompact.messageCount ||
            estimatedTokens < lastUnproductiveCompact.tokens
          );

        if (shouldTryCompact) {
          events.onCompacting();
          const result = await CompactManager.compact(session.id, false, { force: true });
          // Refresh session after compaction
          session = SessionManager.getCurrentSession()!;
          const compactedMessages = session.messages ?? [];
          chatMessages = buildChatMessages(compactedMessages, systemPrompt);
          const compactedEstimatedTokens = estimateRequestTokens(chatMessages, toolDefs);
          if (result.compacted) {
            events.onCompacted(
              result.removedCount,
              result.summary,
              compactedEstimatedTokens
            );
          }
          lastUnproductiveCompact =
            !result.compacted || compactedEstimatedTokens >= estimatedTokens
              ? {
                  tokens: estimatedTokens,
                  messageCount: compactedMessages.length,
                }
              : undefined;
        }

        // ── Stream response ─────────────────────────────────────────────────
        const streamOptions: StreamCompletionOptions = {
          model,
          messages: chatMessages,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
          stream: true,
          signal,
          max_tokens: config.maxOutputTokens,
          reasoningLevel: config.reasoningLevel ?? (config.thinking ? "medium" : "off"),
        };

        const partialToolCalls = new Map<number, PartialToolCall>();
        let accumulatedText = "";
        let accumulatedThinking = "";
        let finishReason: string | null = null;
        let chunkOutputTokens = 0;
        latestPromptTokens = undefined;
        latestCompletionTokens = 0;

        for await (const chunk of manager.stream(streamOptions)) {
          if (signal.aborted) break;

          // Usage may arrive on a usage-only final chunk that carries an empty
          // choices array (OpenAI-compatible stream_options.include_usage).
          // Read it before the choice guard so we don't skip it.
          if (chunk.usage) {
            chunkOutputTokens = chunk.usage.completion_tokens ?? 0;
            latestPromptTokens = chunk.usage.prompt_tokens;
            latestCompletionTokens = chunk.usage.completion_tokens ?? 0;
          }

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

        // ── No tool calls → done (or retry in English) ─────────────────────
        if (finishReason !== "tool_calls" || toolCalls.length === 0) {
          if (
            !languageRetryUsed &&
            accumulatedText &&
            shouldRetryInEnglish(accumulatedText)
          ) {
            languageRetryUsed = true;
            await SessionManager.addMessage({
              role: "user",
              content: "Please respond in English.",
              timestamp: new Date().toISOString(),
            });
            continue;
          }
          await this.flushTurnInjections();
          continueLoop = false;
          break;
        }

        // ── Execute tool calls ──────────────────────────────────────────────
        let allSucceeded = true;
        let advisorCalledThisTurn = false;

        const trackDebugEdit = (
          toolName: string,
          args: Record<string, unknown>
        ): void => {
          if (mode !== "DEBUG") return;
          if (toolName !== "file_edit" && toolName !== "file_write") return;
          const fp =
            (typeof args["filePath"] === "string" && args["filePath"]) ||
            (typeof args["path"] === "string" && args["path"]);
          if (fp) debugEditedFiles.add(fp);
        };

        type PendingTaskItem = { tc: PartialToolCall; args: Record<string, unknown> };
        const pendingTaskBatch: PendingTaskItem[] = [];
        let subagentThinkingEnabled: boolean | undefined;
        let subagentModelResolved: string | undefined;

        const persistToolResult = async (
          toolCallId: string,
          output: string
        ): Promise<void> => {
          await SessionManager.addMessage({
            role: "tool",
            content: output,
            tool_call_id: toolCallId,
            timestamp: new Date().toISOString(),
          } as Message);
        };

        const flushTaskBatch = async (): Promise<void> => {
          if (pendingTaskBatch.length === 0) return;

          const batch = pendingTaskBatch.splice(0);
          const runnable: PendingTaskItem[] = [];

          for (const item of batch) {
            if (
              config.advisorMode &&
              isExperimentalAdvisorEnabled(config) &&
              !advisorCalledThisTurn &&
              shouldBlockBeforeAdvisor("task", item.args)
            ) {
              const toolStart = Date.now();
              events.onToolStart(item.tc.id, "task", item.args);
              events.onToolEnd(
                item.tc.id,
                "task",
                { success: false, output: ADVISOR_GATE_MESSAGE },
                Date.now() - toolStart
              );
              await persistToolResult(item.tc.id, ADVISOR_GATE_MESSAGE);
              allSucceeded = false;
              continue;
            }

            const subagentType = item.args["subagent_type"];
            if (mode === "PLAN" && subagentType !== "explore") {
              const planMsg =
                `PLAN mode only allows explore subagents. Use subagent_type="explore" for research-only delegation.`;
              const toolStart = Date.now();
              events.onToolStart(item.tc.id, "task", item.args);
              events.onToolEnd(
                item.tc.id,
                "task",
                { success: false, output: planMsg },
                Date.now() - toolStart
              );
              await persistToolResult(item.tc.id, planMsg);
              allSucceeded = false;
              continue;
            }

            runnable.push(item);
          }

          if (runnable.length === 0) return;

          const generalRunnable = runnable.filter(
            (item) => item.args["subagent_type"] === "general"
          );
          const skipped = new Map<string, ToolResult>();
          let toRun: PendingTaskItem[] = [...runnable];

          if (needsGeneralBatchPermission(generalRunnable.length)) {
            const decision: TaskBatchDecision =
              (await events.onTaskBatchPermission?.({
                count: generalRunnable.length,
                items: generalRunnable.map((item) => ({
                  subagentType: String(item.args["subagent_type"] ?? "general"),
                  description: String(item.args["description"] ?? ""),
                  promptPreview: String(item.args["prompt"] ?? "").slice(0, 200),
                })),
              })) ?? { action: "approve" };

            if (decision.action === "deny") {
              for (const item of generalRunnable) {
                skipped.set(item.tc.id, {
                  success: false,
                  output: "Permission denied: general sub-agent batch was denied.",
                });
              }
              toRun = runnable.filter((item) => item.args["subagent_type"] !== "general");
            } else if (decision.action === "cancel") {
              for (const item of runnable) {
                skipped.set(item.tc.id, {
                  success: false,
                  output: "Sub-agent batch cancelled.",
                });
              }
              toRun = [];
            } else if (decision.action === "run_first") {
              const limit = Math.max(0, decision.count);
              toRun = [];
              let runCount = 0;
              for (const item of runnable) {
                const isExplore = item.args["subagent_type"] === "explore";
                if (isExplore || runCount < limit) {
                  toRun.push(item);
                  if (!isExplore) runCount += 1;
                } else {
                  skipped.set(item.tc.id, {
                    success: false,
                    output: `Sub-agent skipped: batch limited to first ${limit} task(s).`,
                  });
                }
              }
            }
          }

          for (const item of runnable) {
            const skipResult = skipped.get(item.tc.id);
            if (!skipResult) continue;
            const toolStart = Date.now();
            events.onToolStart(item.tc.id, "task", item.args);
            events.onToolEnd(item.tc.id, "task", skipResult, Date.now() - toolStart);
            allSucceeded = false;
            await persistToolResult(item.tc.id, skipResult.output);
          }

          if (toRun.length === 0) return;

          for (const item of toRun) {
            events.onToolStart(item.tc.id, "task", item.args);
          }

          const specs: TaskCallSpec[] = toRun.map((item) => ({
            toolCallId: item.tc.id,
            subagentType: item.args["subagent_type"] as TaskCallSpec["subagentType"],
            prompt: String(item.args["prompt"] ?? ""),
            description: String(item.args["description"] ?? ""),
            thoroughness: item.args["thoroughness"] as TaskCallSpec["thoroughness"],
          }));

          const subagentModel = resolveSubagentModel(config, model);
          if (subagentThinkingEnabled === undefined) {
            subagentThinkingEnabled =
              config.showSubagentThinking &&
              (await resolveSubagentThinkingEnabled(config, subagentModel));
          }
          subagentModelResolved = subagentModel;

          const results = await runTaskBatch(specs, {
            maxConcurrent: MAX_CONCURRENT_SUBAGENTS,
            signal,
            model: subagentModelResolved,
            subagentThinkingEnabled,
            onTaskStatus: (id, status) => events.onSubagentTaskStatus?.(id, status),
          });

          for (const item of toRun) {
            const entry = results.get(item.tc.id);
            const result: ToolResult = entry?.result ?? {
              success: false,
              output: "Sub-agent did not return a result.",
            };
            const durationMs = entry?.durationMs ?? 0;

            if (!result.success) {
              allSucceeded = false;
            }

            events.onToolEnd(item.tc.id, "task", result, durationMs);
            await persistToolResult(item.tc.id, result.output);
          }
        };

        for (const tc of toolCalls) {
          if (signal.aborted) break;

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.argumentsJson);
          } catch {
            args = { raw: tc.argumentsJson };
          }

          // Tool gate enforcement
          if (
            config.advisorMode &&
            isExperimentalAdvisorEnabled(config) &&
            !advisorCalledThisTurn
          ) {
            if (shouldBlockBeforeAdvisor(tc.name, args)) {
              events.onToolStart(tc.id, tc.name, args);
              events.onToolEnd(tc.id, tc.name, {
                success: false,
                output: ADVISOR_GATE_MESSAGE,
              }, 0);
              allSucceeded = false;

              const blockedMsg = {
                role: "tool" as const,
                content: ADVISOR_GATE_MESSAGE,
                tool_call_id: tc.id,
                timestamp: new Date().toISOString(),
              } as unknown as Message;
              await SessionManager.addMessage(blockedMsg as unknown as Message);
              continue;
            }
          }

          // Handle advisor tool specially
          if (tc.name === "consult_advisor" && config.advisorModel) {
            const toolStart = Date.now();
            events.onToolStart(tc.id, "consult_advisor", args);

            // Get full system prompt and tool def summaries
            const fullSystemPrompt = (session as { system?: string }).system ?? "";
            const toolDefSummaries = toolDefs.map((t) => ({
              type: t.type,
              function: { name: t.function.name, description: t.function.description ?? "" },
            }));

            const advisorResult = await runAdvisorConsultation({
              advisorModel: config.advisorModel,
              fullSystemPrompt,
              toolDefinitions: toolDefSummaries,
              fullHistory: chatMessages,
              topic: String(args["topic"] ?? "advisor-consult"),
              context: String(args["context"] ?? ""),
              callType: (args["type"] === "advisory" ? "advisory" : "plan"),
              events,
              signal,
            });

            let userDecision: "proceed" | "decline" | undefined;
            if (
              advisorResult.success &&
              advisorResult.planPath &&
              advisorResult.planMarkdown &&
              events.onPlanApproval
            ) {
              userDecision = await events.onPlanApproval({
                planPath: advisorResult.planPath,
                summary: advisorResult.summary,
                planMarkdown: advisorResult.planMarkdown,
              });
            }

            const resultText = advisorResult.success
              ? JSON.stringify({
                  summary: advisorResult.summary,
                  plan_path: advisorResult.planPath,
                  plan_markdown: advisorResult.planMarkdown,
                  user_decision: userDecision,
                  advisor_model: advisorResult.advisorModel,
                  self_check_passed: advisorResult.selfCheckPassed,
                  note:
                    "Use plan_markdown from this result. Do not file_read plan_path unless verifying on disk.",
                })
              : `Advisor error: ${advisorResult.error ?? "unknown error"}`;

            events.onToolEnd(
              tc.id,
              "consult_advisor",
              { success: advisorResult.success, output: resultText },
              Date.now() - toolStart
            );

            const advisorToolMsg = {
              role: "tool" as const,
              content: resultText,
              tool_call_id: tc.id,
              timestamp: new Date().toISOString(),
            } as unknown as Message;
            await SessionManager.addMessage(advisorToolMsg as unknown as Message);

            advisorCalledThisTurn = true;
            continue;
          }

          if (tc.name === "task") {
            pendingTaskBatch.push({ tc, args });
            continue;
          }

          await flushTaskBatch();

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
            trackDebugEdit(tc.name, args);
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
            isExperimentalAdvisorEnabled(config) &&
            !signal.aborted
          ) {
            this.consecutiveFailures = 0;
            const stuckContext = `Auto-stuck detection: failed ${this.MAX_CONSECUTIVE_FAILURES} times in a row. Last error: ${result.output}. Need corrective guidance.`;
            events.onAdvisorStart(config.advisorModel);

            const toolDefSummaries = toolDefs.map((t) => ({
              type: t.type,
              function: { name: t.function.name, description: t.function.description ?? "" },
            }));

            const fullSystemPrompt = (session as { system?: string }).system ?? "";

            const advisorResult = await runAdvisorConsultation({
              advisorModel: config.advisorModel,
              fullSystemPrompt,
              toolDefinitions: toolDefSummaries,
              fullHistory: chatMessages,
              topic: "auto-stuck-recovery",
              context: stuckContext,
              callType: "advisory",
              events,
              signal,
            });

            const guidance = advisorResult.success ? advisorResult.summary : `Advisor error: ${advisorResult.error ?? "unknown"}`;

            const advisorInjection: Message = {
              role: "assistant",
              content: `[Advisor guidance: ${guidance}]`,
              timestamp: new Date().toISOString(),
            };
            await SessionManager.addMessage(advisorInjection);
          }
        }

        await flushTaskBatch();

        if (!allSucceeded && toolCalls.length > 0) {
          // Keep looping to let the model handle the errors
        }

        if (isTodoOnlyToolBatch(toolCalls.map((tc) => tc.name))) {
          consecutiveTodoOnlyRounds++;
        } else {
          consecutiveTodoOnlyRounds = 0;
        }

        if (
          shouldInjectAllowAllTodoNudge({
            consecutiveTodoOnlyRounds,
            nudgeUsed: allowAllTodoNudgeUsed,
          })
        ) {
          allowAllTodoNudgeUsed = true;
          await SessionManager.addMessage({
            role: "user",
            content: ALLOW_ALL_TODO_NUDGE_MESSAGE,
            timestamp: new Date().toISOString(),
          });
        }

        await this.flushTurnInjections();

        session = SessionManager.getCurrentSession()!;
      }

      if (signal.aborted) {
        return;
      }

      // ── Flush session save & generate title ──────────────────────────────
      session = SessionManager.getCurrentSession();
      if (session) {
        // Flush the per-turn debounced save so the session is on disk
        // with all messages through the completed AI response.
        await SessionManager.save();

        // Generate title after the first completed assistant reply.
        const userCount = session.messages.filter((m) => m.role === "user").length;
        const hasAssistant = session.messages.some((m) => m.role === "assistant");
        if (!session.headerTitle && userCount >= 1 && hasAssistant) {
          const config = await loadConfig();
          const model = resolveTitleModel(session, config);
          if (model) {
            const title = await generateTitle(session.messages, model);
            if (title) {
              await SessionManager.setHeaderTitle(title);
              Bus.publish(HeaderEvents.Updated, { title });
            }
          }
        }
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
      const estimatedContextTokens = estimateRequestTokens(
        buildChatMessages(finalMessages, lastSystemPrompt),
        toolDefs
      );
      const providerContextTokens = latestPromptTokens !== undefined
        ? latestPromptTokens + latestCompletionTokens
        : undefined;
      const contextTokens = providerContextTokens ?? estimatedContextTokens;
      const debugInstrumentationNudge =
        mode === "DEBUG"
          ? buildDebugInstrumentationNudge([...debugEditedFiles])
          : undefined;

      events.onTurnEnd({
        inputTokens: contextTokens,
        outputTokens,
        contextPct: Math.min(1, contextTokens / getContextWindow()),
        tokensPerSecond,
        durationMs,
        ...(debugInstrumentationNudge
          ? { debugInstrumentationNudge }
          : {}),
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

  /** Vision translator model when session vision is on (explicit /vision setup only). */
  private async findVisionModel(config: Awaited<ReturnType<typeof loadConfig>>): Promise<string | null> {
    if (config.visionMode && config.visionModel) {
      return config.visionModel;
    }
    return null;
  }

  /** Translate images via vision model, inject as tool calls in session */
  private async translateImages(
    config: Awaited<ReturnType<typeof loadConfig>>,
    events: LoopEvents,
    signal: AbortSignal,
    userRequest: string
  ): Promise<void> {
    const visionModel = await this.findVisionModel(config);
    if (!visionModel) {
      // No vision model available — inject a warning
      const warningMsg: Message = {
        role: "assistant" as any,
        content: "[Image detected but vision is not configured. Run /vision to set a vision model and enable translation.]",
        timestamp: new Date().toISOString(),
      } as unknown as Message;
      await SessionManager.addMessage(warningMsg);
      return;
    }

    const manager = await getProviderManager();

    for (let i = 0; i < this.pendingImages.length; i++) {
      const { uri: imageUrl, display: imageLabel } = this.pendingImages[i]!;
      const toolId = `vision_${Date.now()}_${i}`;

      events.onToolStart(toolId, "vision_translate", { image: imageLabel });

      try {
        const visionMessages: ChatMessage[] = [
          {
            role: "user",
            content: [
              { type: "text", text: buildVisionTranslatePrompt(userRequest) },
              { type: "image_url", image_url: { url: imageUrl } },
            ] as any,
          },
        ];

        let result = "";
        for await (const chunk of manager.stream({ model: visionModel, messages: visionMessages, stream: true, signal })) {
          if (signal.aborted) break;
          result += chunk.choices[0]?.delta?.content ?? "";
        }

        const description = result.trim() || "(no description)";

        // Add assistant message with tool_call before the tool result
        const assistantMsg: Message = {
          role: "assistant" as any,
          content: null,
          tool_calls: [{
            id: toolId,
            tool: "vision_translate",
            arguments: { image: imageLabel },
            timestamp: new Date().toISOString(),
          }],
          timestamp: new Date().toISOString(),
        } as unknown as Message;
        await SessionManager.addMessage(assistantMsg);

        const toolMsg: Message = {
          role: "tool" as any,
          content: `[${imageLabel}]: ${description}`,
          tool_call_id: toolId,
          timestamp: new Date().toISOString(),
        } as unknown as Message;
        await SessionManager.addMessage(toolMsg);

        events.onToolEnd(toolId, "vision_translate", {
          success: true,
          output: `[${imageLabel}]: ${description.slice(0, 200)}`,
        }, 0);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        events.onToolEnd(toolId, "vision_translate", {
          success: false,
          output: `Vision translation failed: ${errMsg}`,
        }, 0);
      }
    }
  }

}
