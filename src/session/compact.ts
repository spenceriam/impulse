import { Bus, SessionEvents } from "../bus";
import { SessionStoreInstance, Message } from "./store";
import { getProviderManager } from "../api/manager";
import type { ChatMessage } from "../api/types";
import { load as loadConfig } from "../util/config.js";
import {
  COMPACT_TRIGGER_THRESHOLD,
  COMPACT_WARNING_THRESHOLD,
  autoCompactEligible,
  resolveCompactionThreshold,
  resolveCompactUsage,
} from "../util/compaction-thresholds.js";
import {
  MAX_COMPACT_TOOL_MESSAGE_CHARS,
  stubOversizedMessageContent,
} from "../util/tool-output-cap.js";
import { isDebugEnabled, logCachePrefix } from "../util/debug-log.js";

// Canonical threshold/thrash helpers live in util/compaction-thresholds.ts
// (#182). Re-exported here for existing consumers (context-bar, agent loop).
export {
  COMPACT_WARNING_THRESHOLD,
  COMPACT_TRIGGER_THRESHOLD,
  MIN_NEW_MESSAGES_AFTER_COMPACT,
  autoCompactEligible,
} from "../util/compaction-thresholds.js";

/** Steer-style wrap-up inject when context pressure is high (before hard stop). */
export const CONTEXT_WRAPUP_THRESHOLD = 0.80;
/** Safety margin applied to token estimates before emergency compact / hard cutoff. */
export const SAFETY_MARGIN = 1.15;
const TOOL_OUTPUT_RETENTION = 3;               // Keep outputs for last N tool calls
/** Chars of old tool output to reclaim before summarizing (#183 phase 1). */
const PRUNE_BUDGET_CHARS = 60_000;
/** Fraction of the context window the kept tail may occupy (#183 phase 3). */
const TAIL_TARGET_RATIO = 0.2;
/** Skip the LLM summarizer this long after a failure (#184). */
const SUMMARIZER_COOLDOWN_MS = 5 * 60_000;
/** How far below the trigger the speculative band starts (#185). */
const SPECULATIVE_LEAD = 0.05;
/** Max chars for a tool message kept in the recent tail after compaction. */
const MAX_RECENT_TOOL_MESSAGE_CHARS = 8000;

interface CompactConfig {
  threshold: number
  keepRecentCount: number
  systemPrompt: string
}

export interface CompactResult {
  compacted: boolean
  summary: string
  removedCount: number
  newMessageCount: number
  continuationPrompt?: string  // Prompt to continue conversation after compact
}

interface CompactOptions {
  force?: boolean
  /** Focus text from `/compact <instructions>` (#184). */
  focus?: string
}

/** Snapshot of what a compaction would do, shared by sync and speculative paths (#185). */
interface CompactionPlan {
  prunedMessages: Message[];
  headEnd: number;
  tailStart: number;
  todos: TodoItem[];
  focus?: string;
  force: boolean;
}

/** An armed background summary plus the span it was computed for (#185). */
interface ArmedSummary {
  summary: string;
  headEnd: number;
  tailStart: number;
  messageCount: number;
}

interface CacheEntry {
  value: number
  timestamp: number
}

// Todo item interface for context extraction
interface TodoItem {
  id: string
  content: string
  status: string
  priority: string
}

class CompactManagerImpl {
  private static instance: CompactManagerImpl;
  private config: CompactConfig = {
    threshold: COMPACT_TRIGGER_THRESHOLD,  // 60%
    keepRecentCount: 20,
    systemPrompt: "You are a context compaction assistant. Follow the provided summary template precisely.",
  };
  private inProgress: Set<string> = new Set();
  /** Epoch ms until which the summarizer LLM route is skipped (#184). */
  private summarizerCooldownUntil = 0;
  /** Armed background summaries, keyed by session (#185). */
  private armed = new Map<string, ArmedSummary>();
  /** Speculations in flight, keyed by session (#185). */
  private speculating = new Set<string>();
  private usageCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL = 30000;

  private constructor() {}

  static getInstance(): CompactManagerImpl {
    if (!CompactManagerImpl.instance) {
      CompactManagerImpl.instance = new CompactManagerImpl();
    }
    return CompactManagerImpl.instance;
  }

  setConfig(config: Partial<CompactConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CompactConfig {
    return { ...this.config };
  }

  /**
   * Calculate context usage including tool calls
   * 
   * This estimates the token count for what would be sent in the NEXT API request:
   * - System prompt (~3000-5000 tokens depending on mode)
   * - All conversation messages (user + assistant)
   * - Preserved reasoning (thinking content)
   * - Tool call arguments and results
   * - Tool definitions JSON (~1500 tokens)
   * 
   * Note: This is an estimate used before a request is sent. The footer prefers
   * provider usage after a turn completes, then falls back to request estimates.
   */
  async calculateContextUsage(sessionID: string): Promise<number> {
    const cached = this.usageCache.get(sessionID);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.value;
    }

    try {
      const session = await SessionStoreInstance.read(sessionID);

      // Provider anchor (#182): the provider-reported prompt_tokens from the
      // most recent turn, preferred over the chars/token heuristic — same
      // preference order as the footer's resolveFooterContextUsage.
      if (session.lastPromptTokens !== undefined && session.lastPromptTokens > 0) {
        const { usage, source } = resolveCompactUsage({
          providerTokens: session.lastPromptTokens,
          estimatedTokens: 0,
          contextWindow: session.context_window,
        });
        if (source === "provider") {
          this.usageCache.set(sessionID, { value: usage, timestamp: now });
          return usage;
        }
      }

      // Base overhead: system prompt + tool definitions
      // System prompt varies by mode but typically 3000-5000 tokens
      // Tool definitions are ~1500 tokens for all built-in tools
      const baseOverhead = 5000;
      
      const messageTokens = session.messages.reduce((sum: number, msg) => {
        // Content tokens (estimate ~4 chars per token)
        const contentTokens = Math.ceil((msg.content?.length || 0) / 3.5);
        
        // Reasoning/thinking tokens (preserved thinking is sent back to API)
        const reasoningTokens = msg.reasoning_content
          ? Math.ceil(msg.reasoning_content.length / 3.5)
          : 0;
        
        // Tool call tokens - include tool name and arguments
        let toolCallTokens = 0;
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            // Tool name + arguments (stringified)
            const nameTokens = Math.ceil((tc.tool?.length || 0) / 3.5);
            const argsStr = tc.arguments ? JSON.stringify(tc.arguments) : "";
            const argsTokens = Math.ceil(argsStr.length / 3.5);
            // Result tokens (tool results are sent back in continuation)
            const resultTokens = tc.result?.output ? Math.ceil(tc.result.output.length / 3.5) : 0;
            toolCallTokens += nameTokens + argsTokens + resultTokens + 10; // +10 for JSON overhead
          }
        }
        
        // Message format overhead (role, separators, etc.)
        const formatOverhead = 5;
        
        return sum + contentTokens + reasoningTokens + toolCallTokens + formatOverhead;
      }, 0);
      
      const totalTokens = baseOverhead + messageTokens;
      const usage = totalTokens / session.context_window;

      this.usageCache.set(sessionID, {
        value: usage,
        timestamp: now,
      });

      return usage;
    } catch {
      return 0;
    }
  }

  /**
   * Check if should auto-compact (per-model resolved threshold, #182)
   */
  async shouldCompact(sessionID: string): Promise<boolean> {
    const usage = await this.calculateContextUsage(sessionID);
    const session = await SessionStoreInstance.read(sessionID);
    const cfg = await loadConfig();
    const threshold = resolveCompactionThreshold({
      model: session.model,
      userThreshold: cfg.compaction?.threshold,
      modelThresholds: cfg.compaction?.modelThresholds,
    });
    return usage >= threshold;
  }

  /**
   * Check if in warning zone (50–59%)
   */
  async isInWarningZone(sessionID: string): Promise<boolean> {
    return this.isNearThreshold(sessionID);
  }

  /** True when usage sits in the warning band below the trigger (#185). */
  async isNearThreshold(sessionID: string): Promise<boolean> {
    const usage = await this.calculateContextUsage(sessionID);
    const session = await SessionStoreInstance.read(sessionID);
    const threshold = resolveCompactionThreshold({
      model: session.model,
      userThreshold: (await loadConfig()).compaction?.threshold,
      modelThresholds: (await loadConfig()).compaction?.modelThresholds,
    });
    const bandStart = Math.max(COMPACT_WARNING_THRESHOLD, threshold - SPECULATIVE_LEAD);
    return usage >= bandStart && usage < threshold;
  }

  invalidateCache(sessionID: string): void {
    this.usageCache.delete(sessionID);
  }

  private capOversizedToolMessages(messages: Message[]): Message[] {
    return messages.map((msg) => {
      if (msg.role !== "tool" || msg.content.length <= MAX_RECENT_TOOL_MESSAGE_CHARS) {
        return msg;
      }
      return {
        ...msg,
        content: stubOversizedMessageContent(msg.content, MAX_RECENT_TOOL_MESSAGE_CHARS),
      };
    });
  }

  private pruneToolOutputs(messages: Message[], budgetChars = PRUNE_BUDGET_CHARS): Message[] {
    const toolCallIndices: number[] = [];

    messages.forEach((msg, index) => {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolCallIndices.push(index);
      }
    });

    const protectedIndices = new Set(toolCallIndices.slice(-TOOL_OUTPUT_RETENTION));

    // Phase 1 (#183): prune the LARGEST old outputs first, up to the budget.
    const sizes = toolCallIndices
      .filter((i) => !protectedIndices.has(i))
      .map((index) => {
        const msg = messages[index]!;
        const chars = (msg.tool_calls ?? []).reduce((sum, tc) => {
          const out = tc.result?.output ?? tc.result?.error ?? "";
          return sum + String(out).length;
        }, 0);
        return { index, chars };
      });
    const toPrune = new Set(planPruneBySize(sizes, protectedIndices, budgetChars));

    return messages.map((msg, index) => {
      if (!msg.tool_calls || protectedIndices.has(index) || !toPrune.has(index)) {
        return msg;
      }

      const prunedToolCalls = msg.tool_calls.map((tc) => {
        if (!tc.result) return tc;
        const prunedResult = { ...tc.result };
        if (prunedResult.output) {
          prunedResult.output = "[Output pruned for context efficiency]";
        }
        if (prunedResult.error) {
          prunedResult.error = "[Error output pruned for context efficiency]";
        }
        return { ...tc, result: prunedResult };
      });

      return { ...msg, tool_calls: prunedToolCalls };
    });
  }

  private buildCompactionPrompt(
    messages: Message[],
    todos: TodoItem[],
    opts: { focus?: string; priorSummary?: string } = {}
  ): string {
    const userMessages: string[] = [];
    const conversationParts: string[] = [];

    const truncateText = (text: string, max: number) =>
      text.length > max ? `${text.slice(0, max - 3)}…` : text;

    for (const msg of messages) {
      const body =
        msg.role === "tool"
          ? truncateText(msg.content, MAX_COMPACT_TOOL_MESSAGE_CHARS)
          : msg.content;
      let text = `[${msg.role.toUpperCase()}]: ${body}`;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const toolNames = msg.tool_calls.map(tc => tc.tool).filter(Boolean).join(", ");
        if (toolNames) {
          text += `\n  Tools: ${toolNames}`;
        }

        for (const tc of msg.tool_calls) {
          const resultText = tc.result?.output || tc.result?.error;
          if (resultText) {
            text += `\n  Result (${tc.tool}): ${truncateText(String(resultText), 300)}`;
          }
        }
      }

      if (msg.reasoning_content?.trim()) {
        text += `\n  Prior reasoning (summary input): ${truncateText(msg.reasoning_content, 400)}`;
      }

      conversationParts.push(text);

      if (msg.role === "user" && msg.content) {
        userMessages.push(truncateText(msg.content, 500));
      }
    }

    const conversationText = conversationParts.join("\n\n");
    const userMessagesList = userMessages.map((m, i) => `${i + 1}. "${m}"`).join("\n");

    const todoLines = todos.map((todo) => `- [${todo.status}] ${todo.content}`);
    const todoSection = todoLines.length > 0 ? todoLines.join("\n") : "(no todos)";

    // #184: iterative update keeps goal/files/decisions continuous instead of
    // re-deriving a fresh handoff each cycle (which degrades a little every time).
    const priorSection = opts.priorSummary
      ? `\n## Previous Summary (UPDATE it, do not replace it)\n${opts.priorSummary}\n\nKeep everything still true from this summary, correct anything that changed, and fold in what is new from the conversation below.`
      : "";
    const focusSection = opts.focus?.trim()
      ? `\n## Focus for this summary\nPrioritize and expand on: ${opts.focus.trim()}\n`
      : "";

    return `You are a context compaction assistant. Create a detailed summary that will serve as a handoff to continue the work without losing critical information.
${priorSection}${focusSection}
## Conversation to Summarize:
${conversationText}

## Current Todos:
${todoSection}

## Create a summary with these sections:

### 1. Primary Request and Intent
Capture ALL of the user's explicit requests and intents in detail. What did they actually ask for?

### 2. Key Technical Concepts
List all important technical concepts, technologies, and frameworks discussed.
- Technology X
- Framework Y
- Pattern Z

### 3. Files and Code Sections
Enumerate specific files examined, modified, or created. Include:
- File path and why it's important
- Summary of changes made (if any)
- Key code snippets that would be needed to continue

Example format:
- src/components/Auth.tsx
  - Purpose: Main authentication component
  - Changes: Added logout button, fixed token refresh
  - Key snippet: const handleLogout = () => { ... }

### 4. Errors and Fixes
List ALL errors encountered and how they were fixed:
- Error: [description]
  - Cause: [what caused it]
  - Fix: [how it was resolved]
  - User feedback: [if user gave specific feedback]

### 5. Problem Solving
Document problems solved and any ongoing troubleshooting efforts.
Distill key decisions and plans from any "Prior reasoning" excerpts above into this section — do not copy reasoning verbatim.

### 6. All User Messages (CRITICAL)
These are all the user's messages (not tool results). Preserve user feedback and intent:
${userMessagesList || "(no user messages to summarize)"}

### 7. Pending Tasks
Outline any tasks explicitly requested but NOT yet completed:
- [ ] Task 1
- [ ] Task 2

### 8. Current Work
Describe PRECISELY what was being worked on immediately before this summary.
- What file/feature was being modified?
- What was the last action taken?
- What would the next immediate step be?

### 9. User Preferences and Decisions
- Coding style preferences
- Tool/approach preferences
- Decisions made and their reasoning
- Constraints mentioned

### 10. Optional Next Step
If there's an obvious next step directly aligned with the user's most recent request:
- State it clearly
- Include any context needed to execute it

IMPORTANT: This summary replaces the entire conversation history. Be thorough and accurate.`;
  }

  /**
   * Generate a continuation prompt based on session context
   * Used after auto-compact to continue work naturally
   */
  generateContinuationPrompt(summary: string, todos: TodoItem[]): string {
    const parts: string[] = [];
    
    // Add context about what was happening
    parts.push("Based on our conversation so far:");
    parts.push(summary);
    
    // Add remaining todos if any
    const pendingTodos = todos.filter(t => t.status === "pending" || t.status === "in_progress");
    if (pendingTodos.length > 0) {
      parts.push("\nRemaining tasks:");
      for (const todo of pendingTodos) {
        const status = todo.status === "in_progress" ? "[in progress]" : "[pending]";
        parts.push(`- ${status} ${todo.content}`);
      }
    }
    
    // Natural continuation - no "we're continuing" language
    parts.push("\nPlease continue where we left off.");
    
    return parts.join("\n");
  }

  /**
   * Generate a "what next?" prompt for manual compact
   * Shows context and asks user what to focus on
   */
  generateWhatNextPrompt(summary: string, todos: TodoItem[]): string {
    const parts: string[] = [];
    
    parts.push("Here's a summary of our conversation so far:");
    parts.push(summary);
    
    // Show completed and remaining work
    const completedTodos = todos.filter(t => t.status === "completed");
    const pendingTodos = todos.filter(t => t.status === "pending" || t.status === "in_progress");
    
    if (completedTodos.length > 0) {
      parts.push("\nCompleted:");
      for (const todo of completedTodos.slice(-5)) { // Last 5 completed
        parts.push(`- [done] ${todo.content}`);
      }
    }
    
    if (pendingTodos.length > 0) {
      parts.push("\nRemaining tasks:");
      for (const todo of pendingTodos) {
        const status = todo.status === "in_progress" ? "[in progress]" : "[pending]";
        parts.push(`- ${status} ${todo.content}`);
      }
    }
    
    parts.push("\nWhat would you like to focus on next?");
    
    return parts.join("\n");
  }

  /**
   * Compact the session
   * @param sessionID Session to compact
   * @param isManual If true, generates "what next?" prompt instead of continuation
   */
  async compact(
    sessionID: string,
    isManual: boolean = false,
    options: CompactOptions = {}
  ): Promise<CompactResult> {
    if (this.inProgress.has(sessionID)) {
      throw new Error(`Compaction already in progress for session ${sessionID}`);
    }

    this.inProgress.add(sessionID);
    Bus.publish(SessionEvents.Status, {
      sessionID,
      status: "compacting",
    });

    try {
      await SessionStoreInstance.flushSave(sessionID);
      const session = await SessionStoreInstance.read(sessionID);
      const messages = this.capOversizedToolMessages(session.messages);
      // Phase 1 (#183): prune the largest old tool outputs before any
      // summarizer call, using the fixed budget as the target.
      const prunedMessages = this.pruneToolOutputs(messages);
      const todos = session.todos || [];

      // Phase 2 (#183): system prompt + first exchange never get summarized.
      const headEnd = planHeadBoundary(prunedMessages);

      // Phase 3 (#183): size the kept tail by TOKEN BUDGET, not message count.
      const contextWindow = session.context_window || 0;
      // `force` (manual compact) keeps a smaller tail so more gets summarized.
      const tailTarget = Math.max(
        1,
        Math.floor((contextWindow || 0) * TAIL_TARGET_RATIO) ||
          this.config.keepRecentCount * 500
      ) * (options.force ? 0.5 : 1);
      const messageTokens = prunedMessages.map((m) => estimateMessageTokens(m));
      const tailStart = Math.max(
        headEnd,
        planTailBoundary(messageTokens, tailTarget)
      );

      const plan = {
        prunedMessages,
        headEnd,
        tailStart,
        todos,
        ...(options.focus ? { focus: options.focus } : {}),
        force: options.force === true,
      };

      if (plan.prunedMessages.length <= plan.tailStart) {
        // Nothing to compact - still generate a "what next?" prompt for manual compacts
        const result: CompactResult = {
          compacted: false,
          summary: "",
          removedCount: 0,
          newMessageCount: plan.prunedMessages.length,
        };

        if (isManual) {
          result.continuationPrompt = "The conversation is already within size limits - no compaction needed.\n\nWhat would you like to focus on next?";

          // Still publish event so UI shows the message
          Bus.publish(SessionEvents.Compacted, {
            sessionID,
            summary: "",
            removedCount: 0,
            isManual: true,
            continuationPrompt: result.continuationPrompt,
          });
        }

        return result;
      }

      // #185: an armed speculative summary commits instantly when it still
      // matches this plan's span.
      const armed = this.takeArmedSummary(sessionID, plan);
      let summary: string;
      if (armed) {
        summary = armed;
      } else {
        const prepared = await this.prepareCompaction(plan, sessionID);
        if (!prepared.messagesToCompact) {
          return {
            compacted: false,
            summary: "",
            removedCount: 0,
            newMessageCount: plan.prunedMessages.length,
          };
        }
        const summarized = await this.summarizeMessages(
          prepared.messagesToCompact,
          plan.todos,
          {
            ...(plan.focus ? { focus: plan.focus } : {}),
            ...(prepared.priorSummary ? { priorSummary: prepared.priorSummary } : {}),
          }
        );
        summary = summarized.summary;
      }

      const systemMessage: Message = {
        role: "system",
        content: `Previous conversation summary:\n\n${summary}`,
        timestamp: new Date().toISOString(),
      };

      const newMessages = [
        systemMessage,
        ...plan.prunedMessages.slice(0, plan.headEnd),
        ...plan.prunedMessages.slice(plan.tailStart),
      ] as Message[];

      await SessionStoreInstance.update(sessionID, {
        messages: newMessages,
      });

      // Cache-aware placement (#193): the summary is the FIRST message, so
      // the post-compaction prefix is [summary, head, tail] and the provider
      // can cache it fresh. The old prefix is gone either way, so say it once.
      this.invalidateCache(sessionID);
      if (isDebugEnabled()) {
        await logCachePrefix({
          systemPrompt: `[post-compaction] ${summary.slice(0, 200)}`,
          toolCount: 0,
        });
      }

      // Generate appropriate continuation prompt
      const continuationPrompt = isManual
        ? this.generateWhatNextPrompt(summary, todos)
        : this.generateContinuationPrompt(summary, todos);

      Bus.publish(SessionEvents.Compacted, {
        sessionID,
        summary,
        removedCount: Math.max(0, plan.tailStart - plan.headEnd),
        isManual,
        continuationPrompt,
      });

      return {
        compacted: true,
        summary,
        removedCount: Math.max(0, plan.tailStart - plan.headEnd),
        newMessageCount: newMessages.length,
        continuationPrompt,
      };
    } catch (e) {
      console.error(`Failed to compact session ${sessionID}:`, e);
      throw e;
    } finally {
      this.inProgress.delete(sessionID);
      Bus.publish(SessionEvents.Status, {
        sessionID,
        status: "idle",
      });
    }
  }

  private async summarizeMessages(
    messages: Message[],
    todos: TodoItem[],
    opts: { focus?: string; priorSummary?: string } = {}
  ): Promise<{ summary: string; fallback: boolean }> {
    const prunedMessages = this.pruneToolOutputs(messages);
    const prompt = this.buildCompactionPrompt(prunedMessages, todos, opts);

    // Cooldown after a failed summarizer call: skip the LLM route and use the
    // deterministic fallback instead of burning another call (and another wait).
    if (Date.now() < this.summarizerCooldownUntil) {
      return { summary: buildFallbackSummary(messages), fallback: true };
    }

    try {
      const apiMessages: ChatMessage[] = [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: prompt },
      ];

      const manager = await getProviderManager();
      // Use default model from config (no hardcoded provider/model)
      const response = await manager.complete({
        messages: apiMessages,
        temperature: 0.3,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return { summary: content, fallback: false };
      }
      return { summary: buildFallbackSummary(messages), fallback: true };
    } catch (e) {
      console.error("Failed to generate AI summary:", e);
      this.summarizerCooldownUntil = Date.now() + SUMMARIZER_COOLDOWN_MS;
      return { summary: buildFallbackSummary(messages), fallback: true };
    }
  }

  /** Resolve what a compaction of this session would summarize (#185). */
  private async prepareCompaction(plan: CompactionPlan, sessionID: string): Promise<{
    messagesToCompact: Message[] | null;
    priorSummary?: string;
  }> {
    const session = await SessionStoreInstance.read(sessionID);
    const messagesToCompact = plan.prunedMessages.slice(plan.headEnd, plan.tailStart);
    if (messagesToCompact.length <= 0) return { messagesToCompact: null };
    const priorSummary = session.messages
      .filter((m) => m.role === "system" && m.content.startsWith("Previous conversation summary:"))
      .map((m) => m.content.replace("Previous conversation summary:", "").trim())
      .pop();
    return {
      messagesToCompact,
      ...(priorSummary ? { priorSummary } : {}),
    };
  }

  /** An armed summary is only valid for the exact span it summarized (#185). */
  private takeArmedSummary(sessionID: string, plan: CompactionPlan): string | null {
    const armed = this.armed.get(sessionID);
    if (!armed) return null;
    this.armed.delete(sessionID);
    const sameSpan =
      armed.headEnd === plan.headEnd &&
      armed.tailStart === plan.tailStart &&
      armed.messageCount === plan.prunedMessages.length;
    return sameSpan ? armed.summary : null;
  }

  /**
   * Speculative compaction (#185): when context enters the pre-threshold band,
   * summarize a snapshot in the background so a threshold crossing commits
   * instantly instead of stalling on the summarizer.
   *
   * Returns false when speculation is not applicable (already armed or in
   * flight, no room yet, or the session cannot be read).
   */
  async speculate(sessionID: string): Promise<boolean> {
    if (this.armed.has(sessionID) || this.speculating.has(sessionID)) return false;
    if (this.inProgress.has(sessionID)) return false;

    this.speculating.add(sessionID);
    try {
      await SessionStoreInstance.flushSave(sessionID);
      const session = await SessionStoreInstance.read(sessionID);
      const messages = this.capOversizedToolMessages(session.messages);
      const prunedMessages = this.pruneToolOutputs(messages);
      const headEnd = planHeadBoundary(prunedMessages);
      const contextWindow = session.context_window || 0;
      const tailTarget = Math.max(
        1,
        Math.floor(contextWindow * TAIL_TARGET_RATIO) || this.config.keepRecentCount * 500
      );
      const tailStart = Math.max(
        headEnd,
        planTailBoundary(prunedMessages.map((m) => estimateMessageTokens(m)), tailTarget)
      );
      if (prunedMessages.length <= tailStart) return false;

      const plan: CompactionPlan = {
        prunedMessages,
        headEnd,
        tailStart,
        todos: session.todos || [],
        force: false,
      };
      const prepared = await this.prepareCompaction(plan, sessionID);
      if (!prepared.messagesToCompact) return false;

      const summarized = await this.summarizeMessages(
        prepared.messagesToCompact,
        plan.todos,
        prepared.priorSummary ? { priorSummary: prepared.priorSummary } : {}
      );
      if (summarized.fallback) return false;  // never arm a degraded summary
      this.armed.set(sessionID, {
        summary: summarized.summary,
        headEnd,
        tailStart,
        messageCount: prunedMessages.length,
      });
      return true;
    } catch {
      return false;
    } finally {
      this.speculating.delete(sessionID);
    }
  }

  /** True when a summary is armed and can commit without a summarizer call. */
  hasArmedSummary(sessionID: string): boolean {
    return this.armed.has(sessionID);
  }

  /** Drop an armed summary (e.g. on a branch change or new session). */
  discardArmedSummary(sessionID: string): void {
    this.armed.delete(sessionID);
  }

  /**
   * Auto-compact if threshold reached
   * Called after each message is added
   */
  async maybeCompact(sessionID: string): Promise<CompactResult | null> {
    if (!(await this.shouldCompact(sessionID))) {
      // #185: in the pre-threshold band, arm a summary in the background so a
      // later threshold crossing commits without the summarizer stall.
      if (await this.isNearThreshold(sessionID)) {
        void this.speculate(sessionID);
      }
      return null;
    }

    const session = await SessionStoreInstance.read(sessionID);
    // Thrash guard (#179): only compact when enough NEW messages have
    // accumulated to be worth summarizing. When the recent tail alone exceeds
    // the threshold, compaction cannot help — compacting once per message
    // just burns summarizer calls and re-feeds the summary back into itself.
    // The hard-limit hint (Use /compact or /new) is the graceful path then.
    if (!autoCompactEligible(session.messages.length, this.config.keepRecentCount)) {
      return null;
    }

    return await this.compact(sessionID, false);  // Auto-compact, not manual
  }

  isInProgress(sessionID: string): boolean {
    return this.inProgress.has(sessionID);
  }
}

/**
 * Deterministic fallback summary (#184): if the summarizer call fails or is
 * cooling down, keep the important structured facts instead of dropping the
 * handoff entirely. Same 9-section skeleton, filled from what the messages
 * themselves contain.
 */
export function buildFallbackSummary(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content?.trim());
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content?.trim());
  const files = new Set<string>();
  for (const m of messages) {
    for (const tc of m.tool_calls ?? []) {
      const arg = JSON.stringify(tc.arguments ?? {});
      for (const hit of arg.matchAll(/"((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|json|md|py|go|rs|java|sh|yml|yaml))"/g)) {
        files.add(hit[1]!);
      }
    }
  }

  const lines = [
    "### 1. Primary Request and Intent",
    firstUser?.content.trim() ?? "(no user message captured)",
    "",
    "### 3. Files and Code Sections",
    files.size > 0 ? [...files].slice(0, 20).map((f) => `- ${f}`).join("\n") : "(none detected)",
    "",
    "### 8. Current Work",
    lastAssistant?.content.trim().slice(0, 1500) ?? "(no assistant reply captured)",
    "",
    "_(Fallback summary: the summarizer did not produce one, so this is built from the conversation's own structure.)_",
  ];
  return lines.join("\n");
}

/**
 * Rough per-message token estimate for tail sizing (#183 phase 3). Same
 * chars/token heuristic the context-usage path uses; only relative sizes
 * matter here.
 */
export function estimateMessageTokens(message: {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{ tool?: string; arguments?: unknown; result?: { output?: string; error?: string } }>;
}): number {
  const perToken = 3.5;
  let chars = message.content?.length ?? 0;
  chars += message.reasoning_content?.length ?? 0;
  for (const tc of message.tool_calls ?? []) {
    chars += tc.tool?.length ?? 0;
    chars += JSON.stringify(tc.arguments ?? {}).length;
    chars += String(tc.result?.output ?? tc.result?.error ?? "").length;
  }
  return Math.ceil(chars / perToken);
}

/**
 * Prune the LARGEST old tool outputs first (#183 phase 1), instead of stubbing
 * all-but-the-last-N uniformly. The recent tail is protected by index; among
 * the rest, biggest outputs are stubbed until the reclaimed chars cover the
 * prune budget.
 */
export function planPruneBySize(
  sizes: Array<{ index: number; chars: number }>,
  protectedIndices: Set<number>,
  budgetChars: number
): number[] {
  const candidates = sizes
    .filter((s) => !protectedIndices.has(s.index) && s.chars > 0)
    .sort((a, b) => b.chars - a.chars || a.index - b.index);

  const pruned: number[] = [];
  let reclaimed = 0;
  for (const candidate of candidates) {
    if (reclaimed >= budgetChars) break;
    pruned.push(candidate.index);
    reclaimed += candidate.chars;
  }
  return pruned.sort((a, b) => a - b);
}

/**
 * Choose the tail boundary by TOKEN BUDGET rather than message count
 * (#183 phase 3): walk backwards from the newest message, keeping messages
 * until `targetTokens` is reached. Returns the index of the first kept
 * message, or messages.length when everything fits.
 */
export function planTailBoundary(
  messageTokens: number[],
  targetTokens: number
): number {
  let accumulated = 0;
  let index = messageTokens.length;
  while (index > 0) {
    const next = messageTokens[index - 1] ?? 0;
    if (accumulated + next > targetTokens && accumulated > 0) break;
    accumulated += next;
    index -= 1;
  }
  return index;
}

/**
 * Protect the head (#183 phase 2): system prompt plus the first exchange
 * (first user message and the assistant reply that follows it) never enters
 * the summarized span. Returns the index after the protected head.
 */
export function planHeadBoundary(messages: Array<{ role: string }>): number {
  const firstUser = messages.findIndex((m) => m.role === "user");
  if (firstUser < 0) return 0;
  const assistantAfter = messages.findIndex(
    (m, i) => i > firstUser && m.role === "assistant"
  );
  return assistantAfter < 0 ? firstUser + 1 : assistantAfter + 1;
}

export const CompactManager = CompactManagerImpl.getInstance();
