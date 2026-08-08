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
import { formatToolArgParseError, parseToolCallArguments } from "../tools/parse-tool-args.js";
import { type Message } from "../session/store";
import { buildVisionTranslatePrompt, buildVisionSelfKnowledge } from "./vision-prompt.js";

// ── Debug logging ────────────────────────────────────────────────────────────
const debugLogPath = path.join(Global.Path.logs, "debug.log");

function debugLog(msg: string): void {
  if (!isDebugEnabled()) return;
  const timestamp = new Date().toISOString();
  try {
    fs.mkdirSync(Global.Path.logs, { recursive: true });
    fs.appendFileSync(debugLogPath, `[${timestamp}] [loop] ${msg}\n`);
  } catch {
    // Non-fatal when logs dir cannot be created
  }
}
import {
  isDebugEnabled,
  logAPIRequest,
  logRawAPIMessages,
} from "../util/debug-log.js";
import { bashRepeatNote, todoUnchangedRepeatNote } from "./repeat-notes.js";
import { SessionManager } from "../session/manager";
import { generateTitle } from "../session/title-generator.js";
import { resolveTitleModel } from "../session/enrich-titles.js";
import { Bus, HeaderEvents } from "../bus/index.js";
import {
  CompactManager,
  COMPACT_TRIGGER_THRESHOLD,
  CONTEXT_WRAPUP_THRESHOLD,
  SAFETY_MARGIN,
} from "../session/compact";
import {
  applySafetyMargin,
  estimateRequestTokens,
  resolveFooterContextUsage,
  type FooterContextTokenSource,
} from "../session/token-estimate.js";
import { setAgentTurnActive } from "../session/turn-active.js";
import {
  ALLOW_ALL_TODO_NUDGE_MESSAGE,
  isTodoOnlyToolBatch,
  shouldInjectAllowAllTodoNudge,
} from "./allow-all-nudge.js";
import { finalizeAbortedTurn } from "./abort-interruption.js";
import {
  isSubstantiveToolBatch,
  PLANNING_LOOP_NUDGE_MESSAGE,
  shouldInjectPlanningLoopNudge,
} from "./planning-nudge.js";
import { formatSteeringNote } from "./steer-injection.js";
import { isTodoWriteRealUpdate } from "./todo-progress.js";
import {
  createLoopGuardCounters,
  forceFinalReason,
  heuristicTrippedReason,
  shouldForceFinal,
  shouldLoopCheckin,
  snoozeLoopCheckin,
  type LoopCheckinDecision,
} from "./loop-guard.js";
import { buildDebugInstrumentationNudge } from "./debug-nudge.js";
import { generateSystemPrompt, invalidatePromptCache } from "../agent/prompts";
import { setCurrentMode } from "../tools/mode-state";
import { ADVISOR_GATE_MESSAGE, shouldBlockBeforeAdvisor } from "./advisor-gate.js";
import { shouldRetryInEnglish } from "./language-guard.js";
import type { Mode } from "../constants";
import {
  checkPlanCompletionHandoff,
  planCompletionToolBehavior,
  type PlanCompletionDecision,
} from "./plan-completion.js";
import { modelSupportsVision } from "../api/capabilities.js";
import type { PromptSegment } from "../cli/prompt-input.js";
import { buildUserMessageContent, normalizePasteContent } from "../cli/prompt-input.js";
import { capToolResultContent } from "../util/tool-output-cap.js";
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
import {
  accumulateToolCallDelta,
  type PartialToolCall,
} from "./tool-call-accumulator.js";

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
  /**
   * Block until the user decides how to handle a PLAN → AGENT handoff once
   * plan artifacts (tasks.md) exist. Intercepts set_mode("AGENT") from PLAN.
   */
  onPlanCompletion?: (input: {
    planPath: string;
    summary: string;
  }) => Promise<PlanCompletionDecision>;
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
  /** Loop guard check-in when heuristics trip after iteration 60. */
  onLoopCheckin?: (input: {
    reason: string;
    iteration: number;
  }) => Promise<LoopCheckinDecision>;
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
    contextTokenSource: FooterContextTokenSource;
    /** Prompt tokens served from provider cache this turn (when reported). */
    cacheReadTokens?: number;
    /** DEBUG mode: leftover [IMPULSE_DEBUG] markers in edited files. */
    debugInstrumentationNudge?: string;
  }): void;
  onHardCutoff(contextTokens: number): void;
  /** Fatal error */
  onError(err: Error): void;
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
  /** One wrap-up inject per agent turn when context is high. */
  private contextWrapupInjected = false;

  /** Images to translate before next turn (uri + display label for tool UI). */
  setImages(images: Array<{ uri: string; display: string }>): void {
    this.pendingImages = images;
  }

  /** Redirect current turn at the next tool-loop boundary. */
  setSteer(text: string): void {
    this.pendingSteer = text.trim();
  }

  private async injectUserNotes(notes: string[]): Promise<void> {
    const trimmed = notes.map((n) => n.trim()).filter((n) => n.length > 0);
    if (trimmed.length === 0) return;
    await SessionManager.addMessage({
      role: "user",
      content: trimmed.join("\n\n"),
      injected: true,
      timestamp: new Date().toISOString(),
    });
  }

  private async flushTurnInjections(extraNotes: string[] = []): Promise<void> {
    const notes = [...extraNotes];
    if (this.pendingSteer) {
      const note = this.pendingSteer;
      this.pendingSteer = null;
      notes.push(formatSteeringNote(note));
    }
    // Drain any background-job completion notifications queued while idle
    try {
      const { drainBgNotifications } = await import("../tools/bg-process-registry.js");
      const bgNotes = drainBgNotifications();
      notes.push(...bgNotes);
    } catch { /* non-fatal — bg registry not loaded */ }
    await this.injectUserNotes(notes);
  }

  async run(
    userMessage: string,
    mode: Mode,
    events: LoopEvents,
    turnOptions?: RunTurnOptions
  ): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    setAgentTurnActive(true);

    let abortIterationText = "";
    let abortIterationAssistantPersisted = false;

    try {
      const config = await loadConfig({ refresh: true });
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

      const { canonicalImpulseModelId } = await import("../harness/model-routing.js");
      const { setCurrentCanonicalModelId } = await import("../harness/request-context.js");
      setCurrentCanonicalModelId(canonicalImpulseModelId(model, config.defaultProvider));

      const displayMessage = turnOptions?.displayMessage ?? userMessage;
      this.pendingUserRequest = displayMessage;
      const segments = turnOptions?.segments;
      const nativeVision = await modelSupportsVision(
          model,
          // discover: try provider API first
          async () => {
            try {
              const provider = manager.getProvider(model);
              return provider.discoverModelCapabilities
                ? await provider.discoverModelCapabilities(model)
                : undefined;
            } catch {
              return undefined;
            }
          },
          // probe: send a tiny image to verify vision support
          async () => {
            try {
              const provider = manager.getProvider(model);
              const { probeVisionCapability } = await import('../api/vision-probe.js');
              return probeVisionCapability(
                (opts) => provider.complete({ ...opts, stream: false }),
                model
              );
            } catch {
              return undefined;
            }
          }
        );

      const apiContent: Message["apiContent"] =
        segments && segments.length > 0
          ? (buildUserMessageContent(segments, nativeVision) as Message["apiContent"])
          : userMessage;

      const storedApiContent: Message["apiContent"] =
        apiContent === undefined
          ? undefined
          : typeof apiContent === "string"
            ? apiContent.includes("\r")
              ? normalizePasteContent(apiContent)
              : apiContent
            : apiContent.map((part) =>
                part.type === "text" && part.text.includes("\r")
                  ? { ...part, text: normalizePasteContent(part.text) }
                  : part
              );

      const orderedImages =
        segments && segments.length > 0
          ? segments
              .filter((s): s is Extract<PromptSegment, { kind: "image" }> => s.kind === "image")
              .sort((a, b) => a.index - b.index)
              .map((s) => ({ uri: s.uri, display: s.display }))
          : [...this.pendingImages];

      const hasTextPaste = segments?.some((s) => s.kind === "paste") ?? false;
      const rawTranscript =
        hasTextPaste && typeof storedApiContent === "string"
          ? storedApiContent
          : displayMessage;
      const transcriptContent = normalizePasteContent(rawTranscript);

      const userMsg: Message = {
        role: "user",
        content: transcriptContent,
        ...(storedApiContent !== undefined ? { apiContent: storedApiContent } : {}),
        timestamp: new Date().toISOString(),
      };
      await SessionManager.addMessage(userMsg);
      session = SessionManager.getCurrentSession()!;

      if (orderedImages.length > 0 && !nativeVision) {
        const visionModel =
          config.visionModelOverride?.trim() || config.visionModel?.trim();
        if (visionModel) {
          this.pendingImages = orderedImages;
          await this.translateImages(
            { ...config, visionModel, visionMode: true },
            events,
            signal,
            this.pendingUserRequest
          );
        }
      }
      this.pendingImages = [];

      // ── Tool definitions ───────────────────────────────────────────────────
      // let: reassigned when the PLAN-completion handoff switches mode mid-turn
      // (see checkPlanCompletionHandoff below) so subsequent iterations of this
      // same turn see the AGENT tool set instead of the stale PLAN one.
      let toolDefs: ToolDefinition[] = Tool.getAPIDefinitionsForMode(mode);

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
      let latestCacheReadTokens = 0;
      let languageRetryUsed = false;
      let reliabilityFallbackUsed = false;
      const loopGuard = createLoopGuardCounters();
      let lastWritePath = "";
      let allowAllTodoNudgeUsed = false;
      let planningLoopNudgeUsed = false;
      const bashCommandCounts = new Map<string, number>();
      let consecutiveTodoUnchangedCount = 0;
      const debugEditedFiles = new Set<string>();
      let emptyRetryUsed = false;
      let lastUnproductiveCompact:
        | { tokens: number; messageCount: number }
        | undefined;
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
      // Rebuild system prompt each user turn so project instructions, skills,
      // probes, and other dynamic blocks stay fresh. Within-turn tool iterations
      // still hit the memo via lastTurnPromptKey.
      invalidatePromptCache();
      this.contextWrapupInjected = false;
      await this.flushTurnInjections();

      while (continueLoop && !signal.aborted) {
        const currentMessages = (SessionManager.getCurrentSession()?.messages ?? []);
        const baseSystemPrompt = await generateSystemPrompt(mode, undefined, config, {
          sessionId: session.id,
        });
        const visionSelfKnowledge = buildVisionSelfKnowledge({
          nativeVision,
          visionModeEnabled: config.visionMode ?? false,
          visionModel: config.visionModel,
        });
        const systemPrompt = baseSystemPrompt + "\n\n" + visionSelfKnowledge;
        lastSystemPrompt = systemPrompt;
        const { pinSystemPromptForTurn } = await import("../harness/session-cache.js");
        pinSystemPromptForTurn(systemPrompt);
        let chatMessages = buildChatMessages(currentMessages, systemPrompt);

        // Check compaction before each iteration using the same request shape
        // sent to the provider: system prompt, history, preserved reasoning,
        // tool calls/results, and tool definitions.
        let estimatedTokens = estimateRequestTokens(chatMessages, toolDefs);
        const contextWindow = getContextWindow();
        const contextPct = estimatedTokens / contextWindow;
        let safetyAdjustedTokens = applySafetyMargin(estimatedTokens, SAFETY_MARGIN);

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
          estimatedTokens = compactedEstimatedTokens;
          safetyAdjustedTokens = applySafetyMargin(estimatedTokens, SAFETY_MARGIN);
        }

        // Emergency compact if safety-adjusted estimate still exceeds window
        if (safetyAdjustedTokens >= contextWindow && contextWindow > 0) {
          events.onCompacting();
          const emergency = await CompactManager.compact(session.id, false, { force: true });
          session = SessionManager.getCurrentSession()!;
          const postEmergencyMessages = session.messages ?? [];
          chatMessages = buildChatMessages(postEmergencyMessages, systemPrompt);
          const postEmergencyTokens = estimateRequestTokens(chatMessages, toolDefs);
          if (emergency.compacted) {
            events.onCompacted(
              emergency.removedCount,
              emergency.summary,
              postEmergencyTokens
            );
          }
          estimatedTokens = postEmergencyTokens;
          safetyAdjustedTokens = applySafetyMargin(estimatedTokens, SAFETY_MARGIN);
        }

        // High-context wrap-up steer (once per turn) before hard stop
        const postCompactEstimate = estimateRequestTokens(chatMessages, toolDefs);
        const postCompactPct = postCompactEstimate / contextWindow;
        if (
          !this.contextWrapupInjected &&
          contextWindow > 0 &&
          postCompactPct >= CONTEXT_WRAPUP_THRESHOLD &&
          postCompactPct < 1
        ) {
          this.contextWrapupInjected = true;
          await SessionManager.addMessage({
            role: "user",
            content:
              "Context pressure note (apply before your next action): Context is nearly full. Finish concisely, avoid new tool sprawl unless essential, and prepare for compaction.",
            injected: true,
            timestamp: new Date().toISOString(),
          });
          session = SessionManager.getCurrentSession()!;
          chatMessages = buildChatMessages(session.messages ?? [], systemPrompt);
        }

        // Hard cutoff: skip API request if safety-adjusted estimate still exceeds window
        const finalEstimate = estimateRequestTokens(chatMessages, toolDefs);
        const finalSafety = applySafetyMargin(finalEstimate, SAFETY_MARGIN);
        if (finalSafety >= contextWindow && contextWindow > 0) {
          events.onHardCutoff(finalEstimate);
          continueLoop = false;
          break;
        }

        // ── Stream response ─────────────────────────────────────────────────
        let effectiveReasoningLevel =
          config.reasoningLevel ?? (config.thinking ? "medium" : "off");
        if (!reliabilityFallbackUsed && this.consecutiveFailures >= 2) {
          const { reliabilityFallbackForModel } = await import("../harness/reliability.js");
          const { canonicalImpulseModelId } = await import("../harness/model-routing.js");
          const fallback = reliabilityFallbackForModel(
            canonicalImpulseModelId(model, config.defaultProvider),
            config
          );
          reliabilityFallbackUsed = true;
          effectiveReasoningLevel = fallback.reasoningLevel;
          const { formatImpulseUiStatus } = await import("../session/status-events.js");
          await SessionManager.addMessage({
            role: "system",
            content: formatImpulseUiStatus(
              `Reliability profile: reasoning ${fallback.reasoningLevel}`
            ),
            timestamp: new Date().toISOString(),
          });
        }

        const streamOptions: StreamCompletionOptions = {
          model,
          messages: chatMessages,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
          stream: true,
          signal,
          max_tokens: config.maxOutputTokens,
          reasoningLevel: effectiveReasoningLevel,
        };

        await logAPIRequest(model, chatMessages, toolDefs.length > 0 ? toolDefs : undefined);
        await logRawAPIMessages(chatMessages);

        abortIterationText = "";
        abortIterationAssistantPersisted = false;

        const partialToolCalls = new Map<number, PartialToolCall>();
        let accumulatedText = "";
        let accumulatedThinking = "";
        let thinkingPhaseStartedAt: number | null = null;
        let thinkingDurationMs = 0;
        let finishReason: string | null = null;
        let chunkOutputTokens = 0;
        latestPromptTokens = undefined;
        latestCacheReadTokens = 0;

        const closeThinkingPhase = () => {
          if (thinkingPhaseStartedAt === null) return;
          thinkingDurationMs += Date.now() - thinkingPhaseStartedAt;
          thinkingPhaseStartedAt = null;
        };

        for await (const chunk of manager.stream(streamOptions)) {
          if (signal.aborted) break;

          // Usage may arrive on a usage-only final chunk that carries an empty
          // choices array (OpenAI-compatible stream_options.include_usage).
          // Read it before the choice guard so we don't skip it.
          if (chunk.usage) {
            chunkOutputTokens = chunk.usage.completion_tokens ?? 0;
            latestPromptTokens = chunk.usage.prompt_tokens;
            const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
            if (cached !== undefined && cached > 0) {
              latestCacheReadTokens = cached;
            }
          }

          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;
          finishReason = choice.finish_reason ?? finishReason;

          // Text token
          if (delta.content) {
            closeThinkingPhase();
            noteGeneratedChunk(delta.content);
            accumulatedText += delta.content;
            events.onToken(delta.content);
          }

          // Thinking token
          if (delta.reasoning_content) {
            if (thinkingPhaseStartedAt === null) {
              thinkingPhaseStartedAt = Date.now();
            }
            noteGeneratedChunk(delta.reasoning_content);
            accumulatedThinking += delta.reasoning_content;
            events.onThinking(delta.reasoning_content);
            debugLog(`thinking: ${delta.reasoning_content.length} chars`);
          }

          // Tool call fragments
          if (delta.tool_calls) {
            closeThinkingPhase();
            for (const tc of delta.tool_calls) {
              accumulateToolCallDelta(
                partialToolCalls,
                tc,
                (idx) => `call_${idx}_${Date.now()}`,
              );
            }
          }
        }

        abortIterationText = accumulatedText;
        if (signal.aborted) break;

        if (thinkingPhaseStartedAt !== null) {
          thinkingDurationMs += Date.now() - thinkingPhaseStartedAt;
          thinkingPhaseStartedAt = null;
        }

        outputTokens += chunkOutputTokens;

        // ── Persist assistant message ───────────────────────────────────────
        const toolCalls = Array.from(partialToolCalls.values());
        const assistantMsg: Message = {
          role: "assistant",
          content: accumulatedText,
          ...(accumulatedThinking
            ? {
                reasoning_content: accumulatedThinking,
                ...(thinkingDurationMs > 0
                  ? { thinking_duration_ms: thinkingDurationMs }
                  : {}),
              }
            : {}),
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
        abortIterationAssistantPersisted = true;
        abortIterationText = "";

        // ── No tool calls → done (or retry in English) ─────────────────────
        if (toolCalls.length === 0) {
          const recentHadTools = (SessionManager.getCurrentSession()?.messages ?? [])
            .slice(-8)
            .some((m) => m.role === "tool");
          if (
            !accumulatedText.trim() &&
            recentHadTools &&
            !reliabilityFallbackUsed &&
            !emptyRetryUsed
          ) {
            emptyRetryUsed = true;
            this.consecutiveFailures = Math.max(this.consecutiveFailures, 2);
            await this.flushTurnInjections();
            continue;
          }
          if (
            !languageRetryUsed &&
            accumulatedText &&
            shouldRetryInEnglish(accumulatedText)
          ) {
            languageRetryUsed = true;
            await SessionManager.addMessage({
              role: "user",
              content: "Please respond in English.",
              injected: true,
              timestamp: new Date().toISOString(),
            });
            await this.flushTurnInjections();
            continue;
          }
          await this.flushTurnInjections();
          continueLoop = false;
          break;
        }

        // ── Execute tool calls ──────────────────────────────────────────────
        let allSucceeded = true;
        let advisorCalledThisTurn = false;
        let todoBatchHadRealUpdate = false;

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
            content: capToolResultContent(output),
            tool_call_id: toolCallId,
            timestamp: new Date().toISOString(),
          });
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
              const durationMs = Date.now() - toolStart;
              await persistToolResult(item.tc.id, ADVISOR_GATE_MESSAGE);
              events.onToolEnd(
                item.tc.id,
                "task",
                { success: false, output: ADVISOR_GATE_MESSAGE },
                durationMs
              );
              allSucceeded = false;
              continue;
            }

            const subagentType = item.args["subagent_type"];
            if (mode === "PLAN" && subagentType !== "explore") {
              const planMsg =
                `PLAN mode only allows explore subagents. Use subagent_type="explore" for research-only delegation.`;
              const toolStart = Date.now();
              events.onToolStart(item.tc.id, "task", item.args);
              const durationMs = Date.now() - toolStart;
              await persistToolResult(item.tc.id, planMsg);
              events.onToolEnd(
                item.tc.id,
                "task",
                { success: false, output: planMsg },
                durationMs
              );
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
                  output:
                    "[USER DECISION] The user denied this batch of general sub-agent tasks. This is a deliberate decision, not an error — do not retry it or similar variations. Ask the user how they'd like to proceed (use the question tool), propose an alternative that doesn't need sub-agents, or drop this subtask and continue with the rest of the turn.",
                });
              }
              toRun = runnable.filter((item) => item.args["subagent_type"] !== "general");
            } else if (decision.action === "cancel") {
              for (const item of runnable) {
                skipped.set(item.tc.id, {
                  success: false,
                  output:
                    "[USER DECISION] The user cancelled this entire sub-agent batch. This is a deliberate decision, not an error — do not retry it. Ask the user how they'd like to proceed (use the question tool), propose an alternative, or drop this subtask and continue with the rest of the turn.",
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
            const durationMs = Date.now() - toolStart;
            allSucceeded = false;
            await persistToolResult(item.tc.id, skipResult.output);
            events.onToolEnd(item.tc.id, "task", skipResult, durationMs);
          }

          if (toRun.length === 0) return;

          for (const item of toRun) {
            events.onToolStart(item.tc.id, "task", item.args);
          }

          const specs: TaskCallSpec[] = toRun.map((item) => {
            const rawPrompt = String(item.args["prompt"] ?? "");
            const parentContext =
              typeof item.args["context"] === "string" ? item.args["context"].trim() : "";
            const prompt = parentContext
              ? `Parent context:\n${parentContext}\n\nTask:\n${rawPrompt}`
              : rawPrompt;
            const spec: TaskCallSpec = {
              toolCallId: item.tc.id,
              subagentType: item.args["subagent_type"] as TaskCallSpec["subagentType"],
              prompt,
              description: String(item.args["description"] ?? ""),
            };
            const thoroughness = item.args["thoroughness"] as
              | TaskCallSpec["thoroughness"]
              | undefined;
            if (thoroughness !== undefined) {
              spec.thoroughness = thoroughness;
            }
            return spec;
          });

          const subagentModel = resolveSubagentModel(config, model);
          if (subagentThinkingEnabled === undefined) {
            subagentThinkingEnabled = await resolveSubagentThinkingEnabled(
              config,
              subagentModel
            );
          }
          subagentModelResolved = subagentModel;

          const results = await runTaskBatch(specs, {
            maxConcurrent: MAX_CONCURRENT_SUBAGENTS,
            signal,
            model: subagentModelResolved,
            subagentReasoningCapable: subagentThinkingEnabled,
            showSubagentThinkingDetail: config.showSubagentThinking,
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

            await persistToolResult(item.tc.id, result.output);
            events.onToolEnd(item.tc.id, "task", result, durationMs);
          }
        };

        for (const tc of toolCalls) {
          if (signal.aborted) break;

          const parsedArgs = parseToolCallArguments(tc.argumentsJson);
          const args = parsedArgs.args;

          // Malformed JSON that survived the repair pass: fail fast with a
          // structured, tool-named error before any special-case branch below
          // reads a field off the bogus `{ raw: ... }` fallback shape.
          if (parsedArgs.parseError !== undefined) {
            const toolStart = Date.now();
            events.onToolStart(tc.id, tc.name, args);
            const output = formatToolArgParseError(
              tc.name,
              tc.argumentsJson,
              parsedArgs.parseError,
              parsedArgs.repaired
            );
            const failResult = { success: false, output };
            const durationMs = Date.now() - toolStart;
            await persistToolResult(tc.id, output);
            events.onToolEnd(tc.id, tc.name, failResult, durationMs);
            this.consecutiveFailures++;
            allSucceeded = false;
            continue;
          }

          // Tool gate enforcement
          if (
            config.advisorMode &&
            isExperimentalAdvisorEnabled(config) &&
            !advisorCalledThisTurn
          ) {
            if (shouldBlockBeforeAdvisor(tc.name, args)) {
              events.onToolStart(tc.id, tc.name, args);
              allSucceeded = false;

              const blockedMsg: Message = {
                role: "tool",
                content: ADVISOR_GATE_MESSAGE,
                tool_call_id: tc.id,
                timestamp: new Date().toISOString(),
              };
              await SessionManager.addMessage(blockedMsg);
              events.onToolEnd(tc.id, tc.name, {
                success: false,
                output: ADVISOR_GATE_MESSAGE,
              }, 0);
              continue;
            }
          }

          // Handle advisor tool specially
          if (tc.name === "consult_advisor" && config.advisorModel) {
            const toolStart = Date.now();
            events.onToolStart(tc.id, "consult_advisor", args);

            // Mirror main-loop system prompt (session.system is not populated)
            const fullSystemPrompt = lastSystemPrompt;
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

            const durationMs = Date.now() - toolStart;

            const advisorToolMsg: Message = {
              role: "tool",
              content: resultText,
              tool_call_id: tc.id,
              timestamp: new Date().toISOString(),
            };
            await SessionManager.addMessage(advisorToolMsg);
            events.onToolEnd(
              tc.id,
              "consult_advisor",
              { success: advisorResult.success, output: resultText },
              durationMs
            );

            advisorCalledThisTurn = true;
            continue;
          }

          if (tc.name === "task") {
            pendingTaskBatch.push({ tc, args });
            continue;
          }

          await flushTaskBatch();

          // PLAN → AGENT handoff: when the model calls set_mode("AGENT") from
          // PLAN mode with plan artifacts (tasks.md) already written, show the
          // execute/proceed/revise/cancel overlay instead of switching modes
          // silently. Bus events can't await a user decision, so this has to
          // be intercepted here in the tool loop (mirrors the advisor
          // consult_advisor special-case above).
          if (
            tc.name === "set_mode" &&
            args["mode"] === "AGENT" &&
            events.onPlanCompletion
          ) {
            const handoff = checkPlanCompletionHandoff(mode, "AGENT", session.id);
            if (handoff) {
              const toolStart = Date.now();
              events.onToolStart(tc.id, "set_mode", args);

              const decision = await events.onPlanCompletion({
                planPath: handoff.planDirRel,
                summary: String(args["reason"] ?? ""),
              });
              const behavior = planCompletionToolBehavior(decision, handoff.tasksPathRel);

              let switchResult: ToolResult;
              if (behavior.performSwitch) {
                switchResult = await Tool.execute(tc.name, args);
                mode = "AGENT";
                toolDefs = Tool.getAPIDefinitionsForMode("AGENT");
              } else {
                switchResult = { success: true, output: `Mode unchanged (remains ${mode}).` };
              }

              const output = `${switchResult.output}\n\n${behavior.output}`;
              const durationMs = Date.now() - toolStart;
              await persistToolResult(tc.id, output);
              events.onToolEnd(tc.id, "set_mode", { success: switchResult.success, output }, durationMs);
              continue;
            }
          }

          // Question requires a questions array — fail fast with a clear tool row.
          // (Malformed JSON is already handled above, so args here parsed successfully.)
          if (
            tc.name === "question" &&
            (!Array.isArray(args["questions"]) || args["questions"].length === 0)
          ) {
            const toolStart = Date.now();
            events.onToolStart(tc.id, tc.name, args);
            const output = `Invalid question tool arguments: questions array is required (one or more topics with options). Received ${typeof args["context"] === "string" ? "context only" : "incomplete payload"}.`;
            const failResult = { success: false, output };
            const durationMs = Date.now() - toolStart;
            await persistToolResult(tc.id, output);
            events.onToolEnd(tc.id, tc.name, failResult, durationMs);
            this.consecutiveFailures++;
            allSucceeded = false;
            continue;
          }

          // Execute — individual tools are responsible for invoking the
          // centralized permission module when approval is required.
          const toolStart = Date.now();
          events.onToolStart(tc.id, tc.name, args);

          let result = await Tool.execute(tc.name, args);
          const durationMs = Date.now() - toolStart;

          if (!result.success) {
            this.consecutiveFailures++;
            allSucceeded = false;
          } else {
            this.consecutiveFailures = 0;
          }

          if (
            mode === "DEBUG" &&
            (tc.name === "file_write" || tc.name === "file_edit") &&
            result.success
          ) {
            const editedPath =
              typeof args["filePath"] === "string" ? args["filePath"] : "";
            if (editedPath) debugEditedFiles.add(editedPath);
          }

          if (tc.name === "bash" && result.success) {
            const cmd =
              typeof args["command"] === "string" ? args["command"].trim() : "";
            if (cmd) {
              const repeatCount = (bashCommandCounts.get(cmd) ?? 0) + 1;
              bashCommandCounts.set(cmd, repeatCount);
              const note = bashRepeatNote(repeatCount);
              if (note) {
                result = { ...result, output: `${result.output}${note}` };
              }
            }
          }

          if (tc.name === "todo_write") {
            if (result.metadata?.["unchanged"] === true) {
              consecutiveTodoUnchangedCount += 1;
              const note = todoUnchangedRepeatNote(consecutiveTodoUnchangedCount);
              if (note) {
                result = { ...result, output: `${result.output}${note}` };
              }
            } else if (result.success) {
              consecutiveTodoUnchangedCount = 0;
            }
          }

          if (isTodoWriteRealUpdate(tc.name, result.output)) {
            todoBatchHadRealUpdate = true;
          }

          // Add tool result to session
          const toolResultMsg: Message = {
            role: "tool",
            content: capToolResultContent(result.output),
            tool_call_id: tc.id,
            timestamp: new Date().toISOString(),
          };
          await SessionManager.addMessage(toolResultMsg);
          events.onToolEnd(tc.id, tc.name, result, durationMs);

          if (tc.name === "file_write" && result.success) {
            const writePath = typeof args["filePath"] === "string" ? args["filePath"] : "";
            if (writePath) {
              if (writePath === lastWritePath) {
                loopGuard.consecutiveSamePathWrites++;
              } else {
                lastWritePath = writePath;
                loopGuard.consecutiveSamePathWrites = 1;
              }
            }
          } else if (tc.name === "file_read") {
            const readPath = typeof args["filePath"] === "string" ? args["filePath"] : "";
            if (readPath && readPath === lastWritePath) {
              loopGuard.consecutiveSamePathWrites = 0;
              lastWritePath = "";
            }
          } else if (isSubstantiveToolBatch([tc.name]) && tc.name !== "file_write") {
            loopGuard.consecutiveSamePathWrites = 0;
            lastWritePath = "";
          }

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

            const advisorResult = await runAdvisorConsultation({
              advisorModel: config.advisorModel,
              fullSystemPrompt: lastSystemPrompt,
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

        const toolNames = toolCalls.map((tc) => tc.name);
        if (isTodoOnlyToolBatch(toolNames)) {
          if (!todoBatchHadRealUpdate) {
            loopGuard.consecutiveTodoOnlyRounds++;
          } else {
            loopGuard.consecutiveTodoOnlyRounds = 0;
          }
        } else {
          loopGuard.consecutiveTodoOnlyRounds = 0;
        }

        const steerPending = this.pendingSteer !== null;
        const batchNotes: string[] = [];

        if (
          !steerPending &&
          shouldInjectAllowAllTodoNudge({
            consecutiveTodoOnlyRounds: loopGuard.consecutiveTodoOnlyRounds,
            nudgeUsed: allowAllTodoNudgeUsed,
          })
        ) {
          allowAllTodoNudgeUsed = true;
          batchNotes.push(ALLOW_ALL_TODO_NUDGE_MESSAGE);
        }

        if (!isSubstantiveToolBatch(toolNames)) {
          const skipPlanningBump =
            isTodoOnlyToolBatch(toolNames) && todoBatchHadRealUpdate;
          if (!skipPlanningBump) {
            loopGuard.planningIterations++;
          }
        } else {
          loopGuard.planningIterations = 0;
          if (
            !toolNames.every((name) => name === "file_write" || name === "todo_write")
          ) {
            loopGuard.consecutiveSamePathWrites = 0;
            lastWritePath = "";
          }
        }

        if (
          !steerPending &&
          shouldInjectPlanningLoopNudge({
            planningIterations: loopGuard.planningIterations,
            nudgeUsed: planningLoopNudgeUsed,
          })
        ) {
          planningLoopNudgeUsed = true;
          batchNotes.push(PLANNING_LOOP_NUDGE_MESSAGE);
        }

        await this.flushTurnInjections(batchNotes);

        loopGuard.loopIteration++;
        if (shouldForceFinal(loopGuard)) {
          const forcedText = await this.runForcedFinalTurn({
            manager,
            model,
            events,
            signal,
            lastSystemPrompt,
            config,
            reason: forceFinalReason(loopGuard),
            noteGeneratedChunk,
          });
          outputTokens += Math.ceil(forcedText.length / 4);
          continueLoop = false;
          break;
        }

        if (shouldLoopCheckin(loopGuard)) {
          const reason = heuristicTrippedReason(loopGuard) ?? "looping detected";
          const decision =
            (await events.onLoopCheckin?.({
              reason,
              iteration: loopGuard.loopIteration,
            })) ?? "continue";

          if (decision === "stop") {
            continueLoop = false;
            break;
          }

          if (decision === "finalize") {
            const forcedText = await this.runForcedFinalTurn({
              manager,
              model,
              events,
              signal,
              lastSystemPrompt,
              config,
              reason,
              noteGeneratedChunk,
            });
            outputTokens += Math.ceil(forcedText.length / 4);
            continueLoop = false;
            break;
          }

          snoozeLoopCheckin(loopGuard);
        }

        session = SessionManager.getCurrentSession()!;
      }

      if (signal.aborted) {
        this.pendingSteer = null;
        await finalizeAbortedTurn({
          iterationText: abortIterationText,
          iterationAssistantPersisted: abortIterationAssistantPersisted,
        });
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
      const contextUsage = resolveFooterContextUsage({
        promptTokens: latestPromptTokens,
        estimatedTokens: estimatedContextTokens,
      });
      const contextTokens = contextUsage.tokens;
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
        contextTokenSource: contextUsage.source,
        ...(latestCacheReadTokens > 0 ? { cacheReadTokens: latestCacheReadTokens } : {}),
        ...(debugInstrumentationNudge
          ? { debugInstrumentationNudge }
          : {}),
      });

    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.message.includes("aborted"))) {
        this.pendingSteer = null;
        await finalizeAbortedTurn({
          iterationText: abortIterationText,
          iterationAssistantPersisted: abortIterationAssistantPersisted,
        });
        return;
      }
      events.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setAgentTurnActive(false);
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

  /** One text-only model call after loop-guard fires — tools disabled. */
  private async runForcedFinalTurn(params: {
    manager: Awaited<ReturnType<typeof getProviderManager>>;
    model: string;
    events: LoopEvents;
    signal: AbortSignal;
    lastSystemPrompt: string;
    config: Awaited<ReturnType<typeof loadConfig>>;
    reason: string;
    noteGeneratedChunk: (text: string) => void;
  }): Promise<string> {
    const { formatImpulseUiStatus } = await import("../session/status-events.js");
    await SessionManager.addMessage({
      role: "system",
      content: formatImpulseUiStatus(
        `Loop guard stopped this turn (${params.reason})`
      ),
      timestamp: new Date().toISOString(),
    });
    await SessionManager.addMessage({
      role: "user",
      content: `[System] Loop guard stopped this turn (${params.reason}). Produce your final summary now — tool calls are disabled for this response.`,
      injected: true,
      timestamp: new Date().toISOString(),
    });

    const messages = buildChatMessages(
      SessionManager.getCurrentSession()?.messages ?? [],
      params.lastSystemPrompt
    );
    const reasoningLevel =
      params.config.reasoningLevel ?? (params.config.thinking ? "medium" : "off");

    let accumulatedText = "";
    for await (const chunk of params.manager.stream({
      model: params.model,
      messages,
      stream: true,
      signal: params.signal,
      max_tokens: params.config.maxOutputTokens,
      reasoningLevel,
    })) {
      if (params.signal.aborted) break;
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        params.noteGeneratedChunk(delta.content);
        accumulatedText += delta.content;
        params.events.onToken(delta.content);
      }
      if (delta?.reasoning_content) {
        params.events.onThinking(delta.reasoning_content);
      }
    }

    if (accumulatedText.trim()) {
      await SessionManager.addMessage({
        role: "assistant",
        content: accumulatedText,
        timestamp: new Date().toISOString(),
      });
    }

    return accumulatedText;
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
          role: "tool",
          content: `[${imageLabel}]: ${description}`,
          tool_call_id: toolId,
          timestamp: new Date().toISOString(),
        };
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
