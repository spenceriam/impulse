import { Bus, SessionEvents } from "../bus";
import { SessionStoreInstance, Message } from "./store";
import { GLMClient } from "../api/client";
import type { ChatMessage } from "../api/types";

// Compact thresholds (exported for StatusLine to use)
export const COMPACT_WARNING_THRESHOLD = 0.70;  // Show "Compacting soon" at 70%
export const COMPACT_TRIGGER_THRESHOLD = 0.85;  // Auto-compact triggers at 85%
const TOOL_OUTPUT_RETENTION = 3;               // Keep outputs for last N tool calls

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
    systemPrompt: "You are a context compaction assistant. Follow the provided summary template precisely.",
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
   * 
   * This estimates the token count for what would be sent in the NEXT API request:
   * - System prompt (~3000-5000 tokens depending on mode)
   * - All conversation messages (user + assistant)
   * - Preserved reasoning (thinking content)
   * - Tool call arguments and results
   * - Tool definitions JSON (~1500 tokens)
   * 
   * Note: This is an estimate. The actual token count is available after each
   * API call in the prompt_tokens field, which the StatusLine now uses.
   */
  async calculateContextUsage(sessionID: string): Promise<number> {
    const cached = this.usageCache.get(sessionID);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.value;
    }

    try {
      const session = await SessionStoreInstance.read(sessionID);
      
      // Base overhead: system prompt + tool definitions
      // System prompt varies by mode but typically 3000-5000 tokens
      // Tool definitions are ~1500 tokens for all built-in tools
      const baseOverhead = 5000;
      
      const messageTokens = session.messages.reduce((sum: number, msg) => {
        // Content tokens (estimate ~4 chars per token)
        const contentTokens = Math.ceil((msg.content?.length || 0) / 4);
        
        // Reasoning/thinking tokens (preserved thinking is sent back to API)
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
            // Result tokens (tool results are sent back in continuation)
            const resultTokens = tc.result?.output ? Math.ceil(tc.result.output.length / 4) : 0;
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

  private pruneToolOutputs(messages: Message[]): Message[] {
    const toolCallIndices: number[] = [];

    messages.forEach((msg, index) => {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolCallIndices.push(index);
      }
    });

    const protectedIndices = new Set(toolCallIndices.slice(-TOOL_OUTPUT_RETENTION));

    return messages.map((msg, index) => {
      if (!msg.tool_calls || protectedIndices.has(index)) {
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

  private buildCompactionPrompt(messages: Message[], todos: TodoItem[]): string {
    const userMessages: string[] = [];
    const conversationParts: string[] = [];

    const truncateText = (text: string, max: number) =>
      text.length > max ? `${text.slice(0, max - 3)}...` : text;

    for (const msg of messages) {
      let text = `[${msg.role.toUpperCase()}]: ${msg.content}`;

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

      conversationParts.push(text);

      if (msg.role === "user" && msg.content) {
        userMessages.push(truncateText(msg.content, 500));
      }
    }

    const conversationText = conversationParts.join("\n\n");
    const userMessagesList = userMessages.map((m, i) => `${i + 1}. "${m}"`).join("\n");

    const todoLines = todos.map((todo) => `- [${todo.status}] ${todo.content}`);
    const todoSection = todoLines.length > 0 ? todoLines.join("\n") : "(no todos)";

    return `You are a context compaction assistant. Create a detailed summary that will serve as a handoff to continue the work without losing critical information.

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
        // Nothing to compact - still generate a "what next?" prompt for manual compacts
        const result: CompactResult = {
          compacted: false,
          summary: "",
          removedCount: 0,
          newMessageCount: messages.length,
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

      const messagesToCompact = messages.slice(0, -this.config.keepRecentCount);
      const recentMessages = messages.slice(-this.config.keepRecentCount);

      const summary = await this.summarizeMessages(messagesToCompact, todos);

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

  private async summarizeMessages(messages: Message[], todos: TodoItem[]): Promise<string> {
    const prunedMessages = this.pruneToolOutputs(messages);
    const prompt = this.buildCompactionPrompt(prunedMessages, todos);

    try {
      const apiMessages: ChatMessage[] = [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: prompt },
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
