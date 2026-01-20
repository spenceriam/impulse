import { Bus, SessionEvents } from "../bus";
import { SessionStoreInstance, Message } from "./store";
import { GLMClient } from "../api/client";
import type { ChatMessage } from "../api/types";

interface CompactConfig {
  threshold: number
  keepRecentCount: number
  systemPrompt: string
}

interface CompactResult {
  compacted: boolean
  summary: string
  removedCount: number
  newMessageCount: number
}

interface CacheEntry {
  value: number
  timestamp: number
}

class CompactManagerImpl {
  private static instance: CompactManagerImpl;
  private config: CompactConfig = {
    threshold: 0.7,
    keepRecentCount: 20,
    systemPrompt: `You are summarizing a coding session conversation. Create a concise summary that captures:
1. The main objectives and what was accomplished
2. Key decisions made and reasoning
3. Important context about the codebase
4. Any errors encountered and how they were resolved

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

  async calculateContextUsage(sessionID: string): Promise<number> {
    const cached = this.usageCache.get(sessionID);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.value;
    }

    try {
      const session = await SessionStoreInstance.read(sessionID);
      const totalTokens = session.messages.reduce((sum: number, msg) => {
        const contentTokens = Math.ceil(msg.content.length / 4);
        const reasoningTokens = msg.reasoning_content
          ? Math.ceil(msg.reasoning_content.length / 4)
          : 0;
        return sum + contentTokens + reasoningTokens;
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

  async shouldCompact(sessionID: string): Promise<boolean> {
    const usage = await this.calculateContextUsage(sessionID);
    return usage >= this.config.threshold;
  }

  invalidateCache(sessionID: string): void {
    this.usageCache.delete(sessionID);
  }

  async compact(sessionID: string): Promise<CompactResult> {
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

      Bus.publish(SessionEvents.Compacted, {
        sessionID,
        summary,
        removedCount: messagesToCompact.length,
      });

      return {
        compacted: true,
        summary,
        removedCount: messagesToCompact.length,
        newMessageCount: newMessages.length,
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
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    try {
      const messages: ChatMessage[] = [
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
        messages,
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

  async maybeCompact(sessionID: string): Promise<CompactResult | null> {
    if (!(await this.shouldCompact(sessionID))) {
      return null;
    }

    return await this.compact(sessionID);
  }

  isInProgress(sessionID: string): boolean {
    return this.inProgress.has(sessionID);
  }
}

export const CompactManager = CompactManagerImpl.getInstance();
