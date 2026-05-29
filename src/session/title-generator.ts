import { getProviderManager } from "../api/manager.js";
import type { Message } from "./store.js";
import type { ChatMessage } from "../api/types.js";

const TITLE_MAX_LENGTH = 60;

const TITLE_SYSTEM_PROMPT =
  `Generate a concise session title (max ${TITLE_MAX_LENGTH} chars) based on this conversation. ` +
  "Return ONLY the title text — no quotes, no prefixes, no explanation.";

/**
 * Generate a session title from the first few exchanges of a conversation.
 * Uses the current provider/model to make a lightweight LLM call.
 *
 * Returns the generated title, or null if generation fails.
 */
export async function generateTitle(
  messages: Message[],
  model: string
): Promise<string | null> {
  try {
    const manager = await getProviderManager();

    // Build a minimal conversation from the first few user/assistant exchanges.
    const titleMessages = buildTitleMessages(messages);

    if (titleMessages.length === 0) return null;

    const response = await manager.getProvider(model).complete({
      messages: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        ...titleMessages,
      ],
      max_tokens: 50,
      temperature: 0.3,
      reasoningLevel: "off",
    });

    const choice = response.choices[0];
    const rawContent = choice?.message?.content;
    const text = typeof rawContent === "string" ? rawContent.trim() : "";
    if (!text) return null;

    // Clean up common wrapping artifacts
    let title = text
      .replace(/^["']|["']$/g, "")
      .replace(/^(title|session|summary):?\s*/i, "")
      .trim();

    if (title.length > TITLE_MAX_LENGTH) {
      title = title.slice(0, TITLE_MAX_LENGTH - 3) + "...";
    }

    return title || null;
  } catch (error) {
    console.error("Failed to generate session title:", error);
    return null;
  }
}

/**
 * Build a condensed conversation for title generation.
 * Takes the first few user-assistant exchanges (up to 4 messages).
 */
/** True when there is enough user/assistant content to generate a title. */
export function hasTitleSource(messages: Message[]): boolean {
  return buildTitleMessages(messages).length > 0;
}

export function buildTitleMessages(messages: Message[]): ChatMessage[] {
  const pairs: ChatMessage[] = [];
  let userMsg: string | null = null;

  for (const msg of messages) {
    if (msg.role === "user" && !userMsg) {
      userMsg = msg.content.slice(0, 200);
    } else if (msg.role === "assistant" && userMsg) {
      pairs.push({ role: "user", content: userMsg });
      pairs.push({ role: "assistant", content: msg.content.slice(0, 200) });
      userMsg = null;

      if (pairs.length >= 4) break;
    }
  }

  // If we have an unanswered user message, include it
  if (userMsg && pairs.length < 4) {
    pairs.push({ role: "user", content: userMsg });
  }

  return pairs;
}
