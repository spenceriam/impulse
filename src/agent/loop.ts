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
import { providerConfig, parseProviderChoice, discoverModels } from "../cli/model-setup.js";
import { load as loadConfig } from "../util/config";
import * as fs from "fs";
import * as path from "path";
import { Global } from "../global.js";
import { Tool } from "../tools/registry";
import { type Message } from "../session/store";

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
import { Bus, HeaderEvents } from "../bus/index.js";
import { CompactManager, COMPACT_TRIGGER_THRESHOLD } from "../session/compact";
import { generateSystemPrompt } from "../agent/prompts";
import { setCurrentMode } from "../tools/mode-state";
import { buildDebugInstrumentationNudge } from "./self-check.js";
import { shouldRetryInEnglish } from "./language-guard.js";
import type { Mode } from "../constants";
import { modelSupportsVision } from "../api/providers/capabilities.js";
import type { PromptSegment } from "../cli/prompt-input.js";
import { buildUserMessageContent } from "../cli/prompt-input.js";

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

function buildChatMessages(sessionMessages: Message[], systemPrompt: string): ChatMessage[] {
  const result: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of sessionMessages) {
    if (m.role === "system") continue; // system prompt already added above
    if (m.role === "user" || m.role === "assistant") {
      const apiContent = (m as Message & { apiContent?: ChatMessage["content"] }).apiContent;
      const content =
        m.role === "user" && apiContent !== undefined
          ? apiContent
          : (m.content ?? "");
      const msg: ChatMessage = { role: m.role, content };
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
  private pendingImages: string[] = [];

  /** Set images to translate before next turn (legacy flat list) */
  setImages(images: string[]): void { this.pendingImages = images; }

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
      const model = config.defaultModel;

      // Sync mode to tool-state so mode-restricted tools work
      setCurrentMode(mode);

      // ── Session setup ──────────────────────────────────────────────────────
      let session = SessionManager.getCurrentSession();
      if (!session) {
        session = await SessionManager.createNew();
      }

      const displayMessage = turnOptions?.displayMessage ?? userMessage;
      const segments = turnOptions?.segments;
      const nativeVision = modelSupportsVision(model);

      const apiContent =
        segments && segments.length > 0
          ? buildUserMessageContent(segments, nativeVision)
          : userMessage;

      const orderedUris =
        segments && segments.length > 0
          ? segments
              .filter((s): s is Extract<PromptSegment, { kind: "image" }> => s.kind === "image")
              .sort((a, b) => a.index - b.index)
              .map((s) => s.uri)
          : [...this.pendingImages];

      const userMsg: Message = {
        role: "user",
        content: displayMessage,
        timestamp: new Date().toISOString(),
      };
      await SessionManager.addMessage(userMsg);
      session = SessionManager.getCurrentSession()!;

      // Patch last user message API content for downstream buildChatMessages
      const sessionAfterUser = SessionManager.getCurrentSession();
      if (sessionAfterUser && sessionAfterUser.messages.length > 0) {
        const last = sessionAfterUser.messages[sessionAfterUser.messages.length - 1]!;
        if (last.role === "user") {
          (last as Message & { apiContent?: unknown }).apiContent = apiContent;
        }
      }

      if (orderedUris.length > 0 && !nativeVision) {
        this.pendingImages = orderedUris;
        await this.translateImages(config, events, signal);
      }
      this.pendingImages = [];

      // ── Tool definitions ───────────────────────────────────────────────────
      const toolDefs: ToolDefinition[] = Tool.getAPIDefinitionsForMode(mode);

      // Add consult_advisor tool if advisor model is configured and mode is ON
      if (config.advisorModel && config.advisorMode) {
        toolDefs.push({
          type: "function",
          function: {
            name: "consult_advisor",
            description:
              "Consult the strategic advisor model before executing. The advisor will review the full conversation " +
              "and produce a structured plan saved to .impulse/advisor-plans/. " +
              "MUST be called before any file writes, edits, bash execution, or subagent launches.",
            parameters: {
              type: "object",
              properties: {
                topic: {
                  type: "string",
                  description: "Brief topic for the plan filename (3-8 words, e.g. 'refactor-auth-module')",
                },
                context: {
                  type: "string",
                  description: "Full context: project map, relevant files, recent output, what you need guidance on",
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
      const contextWindow = session.context_window || 200000;
      const turnStart = Date.now();
      let firstGenerationTime: number | null = null;
      let lastGeneratedAt: number | null = null;
      let activeStreamingMs = 0;
      let estimatedGeneratedTokens = 0;
      let lastSystemPrompt = "";
      let languageRetryUsed = false;
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

        // Hard tool gate: block write/edit/bash/task/todo_write until advisor consulted
        const BLOCKED_BEFORE_ADVISOR = new Set(["file_write", "file_edit", "task", "todo_write"]);

        for (const tc of toolCalls) {
          if (signal.aborted) break;

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.argumentsJson);
          } catch {
            args = { raw: tc.argumentsJson };
          }

          // Tool gate enforcement
          if (config.advisorMode && !advisorCalledThisTurn) {
            if (BLOCKED_BEFORE_ADVISOR.has(tc.name)) {
              events.onToolStart(tc.id, tc.name, args);
              events.onToolEnd(tc.id, tc.name, {
                success: false,
                output: "[GATE] Advisor Mode is active. Call consult_advisor before making changes.",
              }, 0);
              allSucceeded = false;

              const blockedMsg = {
                role: "tool" as const,
                content: "[GATE] Advisor Mode is active. Call consult_advisor before making changes.",
                tool_call_id: tc.id,
                timestamp: new Date().toISOString(),
              } as unknown as Message;
              await SessionManager.addMessage(blockedMsg as unknown as Message);
              continue;
            }
            if (tc.name === "bash" && typeof args["command"] === "string") {
              // Allow read-only bash commands
              const cmd = (args["command"] as string).toLowerCase().trim();
              const isReadOnly = /^(ls|dir|cat|head|tail|wc|grep|find|which|where|type|pwd|echo|printenv|env|whoami|date|uname|git\s+status|git\s+log|git\s+branch|git\s+diff)/i.test(cmd);
              if (!isReadOnly) {
                events.onToolStart(tc.id, tc.name, args);
                events.onToolEnd(tc.id, tc.name, {
                  success: false,
                  output: "[GATE] Advisor Mode is active. Call consult_advisor before executing write commands.",
                }, 0);
                allSucceeded = false;

                const blockedMsg = {
                  role: "tool" as const,
                  content: "[GATE] Advisor Mode is active. Call consult_advisor before executing write commands.",
                  tool_call_id: tc.id,
                  timestamp: new Date().toISOString(),
                } as unknown as Message;
                await SessionManager.addMessage(blockedMsg as unknown as Message);
                continue;
              }
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

            const resultText = advisorResult.success
              ? JSON.stringify({
                  summary: advisorResult.summary,
                  plan_path: advisorResult.planPath,
                  advisor_model: advisorResult.advisorModel,
                  self_check_passed: advisorResult.selfCheckPassed,
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

        if (!allSucceeded && toolCalls.length > 0) {
          // Keep looping to let the model handle the errors
        }

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
          const model = session.model || "ollama/llama3.2";
          const title = await generateTitle(session.messages, model);
          if (title) {
            await SessionManager.setHeaderTitle(title);
            Bus.publish(HeaderEvents.Updated, { title });
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
      const estimatedContextTokens = estimateTokens(buildChatMessages(finalMessages, lastSystemPrompt));
      const debugInstrumentationNudge =
        mode === "DEBUG"
          ? buildDebugInstrumentationNudge([...debugEditedFiles])
          : undefined;

      events.onTurnEnd({
        inputTokens: estimatedContextTokens,
        outputTokens,
        contextPct: Math.min(1, estimatedContextTokens / contextWindow),
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

  /** Auto-detect a vision-capable model from configured providers */
  private async findVisionModel(config: Awaited<ReturnType<typeof loadConfig>>): Promise<string | null> {
    // Use explicitly configured vision model first
    if (config.visionMode && config.visionModel) {
      return config.visionModel;
    }
    // Check advisor model first
    if (config.advisorModel && modelSupportsVision(config.advisorModel)) {
      return config.advisorModel;
    }
    // Check providers for known vision models
    const providerKey = config.defaultProvider;
    const stored = providerConfig(config, providerKey);
    if (stored?.apiKey) {
      // Try to discover models and find a vision-capable one
      try {
        const provider = parseProviderChoice(providerKey, providerKey);
        if (provider) {
          const discovery = await discoverModels(provider, stored.apiKey, stored.baseUrl);
          for (const m of discovery.models) {
            if (modelSupportsVision(m)) {
              return `${provider.key}/${m}`;
            }
          }
        }
      } catch { /* ignore discovery failure */ }
    }
    return null;
  }

  /** Translate images via vision model, inject as tool calls in session */
  private async translateImages(
    config: Awaited<ReturnType<typeof loadConfig>>,
    events: LoopEvents,
    signal: AbortSignal
  ): Promise<void> {
    const visionModel = await this.findVisionModel(config);
    if (!visionModel) {
      // No vision model available — inject a warning
      const warningMsg: Message = {
        role: "assistant" as any,
        content: "[Image detected but no vision model available. Configure a vision-capable model to process images.]",
        timestamp: new Date().toISOString(),
      } as unknown as Message;
      await SessionManager.addMessage(warningMsg);
      return;
    }

    const manager = await getProviderManager();

    for (let i = 0; i < this.pendingImages.length; i++) {
      const imageUrl = this.pendingImages[i]!;
      const toolId = `vision_${Date.now()}_${i}`;

      // Fire tool start event for UI
      events.onToolStart(toolId, "vision_translate", { image: `Image ${i + 1}` });

      try {
        const visionMessages: ChatMessage[] = [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image in detail. Focus on visible text, UI elements, code, errors, layout, and anything relevant to a coding task. Be concise but thorough." },
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
            arguments: { image: `Image ${i + 1}` },
            timestamp: new Date().toISOString(),
          }],
          timestamp: new Date().toISOString(),
        } as unknown as Message;
        await SessionManager.addMessage(assistantMsg);

        const toolMsg: Message = {
          role: "tool" as any,
          content: `[Image ${i + 1}]: ${description}`,
          tool_call_id: toolId,
          timestamp: new Date().toISOString(),
        } as unknown as Message;
        await SessionManager.addMessage(toolMsg);

        events.onToolEnd(toolId, "vision_translate", {
          success: true,
          output: `[Image ${i + 1}]: ${description.slice(0, 200)}`,
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
