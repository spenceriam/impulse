import { Bus, SessionEvents } from "../bus";
import { SessionStoreInstance, Message } from "./store";
import { GLMClient } from "../api/client";
import type { ChatMessage } from "../api/types";

// Compact thresholds (exported for StatusLine to use)
export const COMPACT_WARNING_THRESHOLD = 0.70;  // Show "Compacting soon" at 70%
export const COMPACT_TRIGGER_THRESHOLD = 0.85;  // Auto-compact triggers at 85%

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
    threshold: COMPACT_TRIGGER_THRESHOLD,  // Now 85%
    keepRecentCount: 20,
    systemPrompt: `You are summarizing a coding session conversation. Create a concise summary that captures:
1. The main objectives and what was accomplished
2. Key decisions made and reasoning
3. Important context about the codebase
4. Any errors encountered and how they were resolved
5. Current state of work (what was just being done)

Keep the summary under 500 words. Be factual and precise.`,
  };
  private inProgress: Set<string> = new Set();
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
   * More accurate than just content length
   */
  async calculateContextUsage(sessionID: string): Promise<number> {
    const cached = this.usageCache.get(sessionID);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.value;
    }

    try {
      const session = await SessionStoreInstance.read(sessionID);
      const totalTokens = session.messages.reduce((sum: number, msg) => {
        // Content tokens (estimate ~4 chars per token)
        const contentTokens = Math.ceil((msg.content?.length || 0) / 4);
        
        // Reasoning/thinking tokens
        const reasoningTokens = msg.reasoning_content
          ? Math.ceil(msg.reasoning_content.length / 4)
          : 0;
        
        // Tool call tokens - include tool name and arguments
        let toolCallTokens = 0;
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            // Tool name + arguments (stringified)
            const nameTokens = Math.ceil((tc.tool?.length || 0) / 4);
            const argsStr = tc.arguments ? JSON.stringify(tc.arguments) : "";
            const argsTokens = Math.ceil(argsStr.length / 4);
            // Result if present
            const resultTokens = tc.result?.output ? Math.ceil(tc.result.output.length / 4) : 0;
            toolCallTokens += nameTokens + argsTokens + resultTokens + 10; // +10 for JSON overhead
          }
        }
        
        // System messages with tool results have some overhead
        const isSystemMsg = msg.role === "system";
        const toolResultOverhead = isSystemMsg && msg.content.includes("tool") ? 20 : 0;
        
        return sum + contentTokens + reasoningTokens + toolCallTokens + toolResultOverhead;
      }, 0);
      
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
   * Check if should auto-compact (at 85% threshold)
   */
  async shouldCompact(sessionID: string): Promise<boolean> {
    const usage = await this.calculateContextUsage(sessionID);
    return usage >= this.config.threshold;
  }

  /**
   * Check if in warning zone (70-85%)
   */
  async isInWarningZone(sessionID: string): Promise<boolean> {
    const usage = await this.calculateContextUsage(sessionID);
    return usage >= COMPACT_WARNING_THRESHOLD && usage < COMPACT_TRIGGER_THRESHOLD;
  }

  invalidateCache(sessionID: string): void {
    this.usageCache.delete(sessionID);
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
  async compact(sessionID: string, isManual: boolean = false): Promise<CompactResult> {
    if (this.inProgress.has(sessionID)) {
      throw new Error(`Compaction already in progress for session ${sessionID}`);
    }

    this.inProgress.add(sessionID);
    Bus.publish(SessionEvents.Status, {
      sessionID,
      status: "compacting",
    });

    try {
      const session = await SessionStoreInstance.read(sessionID);
      const messages = session.messages;
      const todos = session.todos || [];

      if (messages.length <= this.config.keepRecentCount) {
        return {
          compacted: false,
          summary: "",
          removedCount: 0,
          newMessageCount: messages.length,
        };
      }

      const messagesToCompact = messages.slice(0, -this.config.keepRecentCount);
      const recentMessages = messages.slice(-this.config.keepRecentCount);

      const summary = await this.summarizeMessages(messagesToCompact);

      const systemMessage: Message = {
        role: "system",
        content: `Previous conversation summary:\n\n${summary}`,
        timestamp: new Date().toISOString(),
      };

      const newMessages = [systemMessage, ...recentMessages] as Message[];

      await SessionStoreInstance.update(sessionID, {
        messages: newMessages,
      });

      // Invalidate cache after compaction
      this.invalidateCache(sessionID);

      // Generate appropriate continuation prompt
      const continuationPrompt = isManual
        ? this.generateWhatNextPrompt(summary, todos)
        : this.generateContinuationPrompt(summary, todos);

      Bus.publish(SessionEvents.Compacted, {
        sessionID,
        summary,
        removedCount: messagesToCompact.length,
        isManual,
        continuationPrompt,
      });

      return {
        compacted: true,
        summary,
        removedCount: messagesToCompact.length,
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

  private async summarizeMessages(messages: Message[]): Promise<string> {
    const conversation = messages
      .map((m) => {
        let content = `${m.role.toUpperCase()}: ${m.content}`;
        // Include tool call info in summary
        if (m.tool_calls && Array.isArray(m.tool_calls)) {
          const toolNames = m.tool_calls.map(tc => tc.tool).filter(Boolean);
          if (toolNames.length > 0) {
            content += `\n[Called tools: ${toolNames.join(", ")}]`;
          }
        }
        return content;
      })
      .join("\n\n");

    try {
      const apiMessages: ChatMessage[] = [
        {
          role: "system",
          content: this.config.systemPrompt,
        },
        {
          role: "user",
          content: conversation,
        },
      ];

      const response = await GLMClient.complete({
        model: "glm-4.7",
        messages: apiMessages,
        temperature: 0.3,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (typeof content === "string") {
        return content;
      }
      return "Failed to generate summary (unexpected content format)";
    } catch (e) {
      console.error("Failed to generate AI summary:", e);
      return "Failed to generate summary. Manual compaction required.";
    }
  }

  /**
   * Auto-compact if threshold reached
   * Called after each message is added
   */
  async maybeCompact(sessionID: string): Promise<CompactResult | null> {
    if (!(await this.shouldCompact(sessionID))) {
      return null;
    }

    return await this.compact(sessionID, false);  // Auto-compact, not manual
  }

  isInProgress(sessionID: string): boolean {
    return this.inProgress.has(sessionID);
  }
}

export const CompactManager = CompactManagerImpl.getInstance();
