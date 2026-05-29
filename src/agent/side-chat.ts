/**
 * Side prompt — isolated single-turn Q&A (no tools, not in session.messages).
 */

import type { ChatMessage } from "../api/types.js";
import { getProviderManager } from "../api/manager.js";
import type { ReasoningLevel } from "../util/config.js";
import type { Message } from "../session/store.js";

export const SIDE_CONTEXT_MAX_CHARS = 4000;

const SIDE_SYSTEM_PROMPT = `You are a brief side assistant for Impulse. Answer the user's clarification question concisely.
You cannot use tools, read files, or modify the project. Do not suggest running commands unless the user explicitly asks.`;

export interface SideChatEvents {
  onToken(text: string): void;
  onThinking(text: string): void;
}

export interface RunSideChatParams {
  model: string;
  userText: string;
  useContext: boolean;
  contextSnapshot?: string;
  reasoningLevel: ReasoningLevel;
  signal: AbortSignal;
  events: SideChatEvents;
}

export interface RunSideChatResult {
  assistantText: string;
  thinkingText: string;
  aborted: boolean;
}

export type ParseSideSlashArgsResult =
  | { kind: "usage" }
  | { kind: "history" }
  | { kind: "question"; question: string; useContext: boolean };

/** Parse `/side` arguments after the command name. */
export function parseSideSlashArgs(arg: string): ParseSideSlashArgsResult {
  const trimmed = arg.trim();
  if (!trimmed) return { kind: "usage" };
  if (trimmed === "--history") return { kind: "history" };

  let useContext = false;
  let rest = trimmed;

  if (rest.startsWith("--context ")) {
    useContext = true;
    rest = rest.slice("--context ".length);
  } else if (rest.startsWith("-c ")) {
    useContext = true;
    rest = rest.slice(3);
  } else if (rest === "--context" || rest === "-c") {
    return { kind: "usage" };
  }

  rest = rest.trim();
  if (!rest) return { kind: "usage" };

  return { kind: "question", question: rest, useContext };
}

/** Bounded read-only excerpt of recent main chat for optional -c / --context. */
export function buildSideContextSnapshot(messages: Message[]): string {
  const parts: string[] = [];
  let total = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = typeof msg.content === "string" ? msg.content.trim() : "";
    if (!text) continue;

    const line = `${msg.role}: ${text.slice(0, 800)}`;
    const nextLen = total + line.length + 2;
    if (nextLen > SIDE_CONTEXT_MAX_CHARS && parts.length > 0) break;
    parts.unshift(line);
    total = nextLen;
  }

  const joined = parts.join("\n\n");
  if (joined.length <= SIDE_CONTEXT_MAX_CHARS) return joined;
  return joined.slice(joined.length - SIDE_CONTEXT_MAX_CHARS);
}

export const SIDE_COPY_ATTRIBUTION = "[Sourced from a side prompt request]";

export function formatSideCopyMarkdown(userText: string, assistantText: string): string {
  return `${SIDE_COPY_ATTRIBUTION}\n\n### Side clarification\n**Q:** ${userText}\n**A:** ${assistantText}`;
}

export async function runSideChat(params: RunSideChatParams): Promise<RunSideChatResult> {
  const {
    model,
    userText,
    useContext,
    contextSnapshot,
    reasoningLevel,
    signal,
    events,
  } = params;

  let userContent = userText;
  if (useContext && contextSnapshot?.trim()) {
    userContent = `Recent main conversation (read-only):\n\n${contextSnapshot}\n\n---\n\nSide question: ${userText}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SIDE_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  const manager = await getProviderManager();
  let assistantText = "";
  let thinkingText = "";

  for await (const chunk of manager.stream({
    model,
    messages,
    stream: true,
    signal,
    reasoningLevel,
  })) {
    if (signal.aborted) break;

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.reasoning_content) {
      thinkingText += delta.reasoning_content;
      events.onThinking(delta.reasoning_content);
    }

    if (delta.content) {
      assistantText += delta.content;
      events.onToken(delta.content);
    }
  }

  return {
    assistantText,
    thinkingText,
    aborted: signal.aborted,
  };
}
