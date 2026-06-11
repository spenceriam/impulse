import type { ChatMessage } from "../api/types.js";
import type { Message } from "../session/store.js";

/** Prefix written by compaction — must reach the provider (not a generic system skip). */
export const COMPACT_SUMMARY_PREFIX = "Previous conversation summary:";

function isCompactSummaryMessage(m: Message): boolean {
  return (
    m.role === "system" &&
    typeof m.content === "string" &&
    m.content.startsWith(COMPACT_SUMMARY_PREFIX)
  );
}

/** Build provider chat messages from session history (includes preserved reasoning). */
export function buildChatMessages(
  sessionMessages: Message[],
  systemPrompt: string
): ChatMessage[] {
  const compactSummaries = sessionMessages
    .filter(isCompactSummaryMessage)
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0);

  let mergedSystem = systemPrompt;
  if (compactSummaries.length > 0) {
    mergedSystem = `${systemPrompt}\n\n${compactSummaries.join("\n\n")}`;
  }

  const result: ChatMessage[] = [{ role: "system", content: mergedSystem }];
  for (const m of sessionMessages) {
    if (m.role === "system") continue;
    if (m.role === "user" || m.role === "assistant") {
      const content =
        m.role === "user" && m.apiContent !== undefined
          ? m.apiContent
          : (m.content ?? "");
      const msg: ChatMessage = { role: m.role, content };
      if (m.role === "assistant" && m.reasoning_content?.trim()) {
        msg.reasoning_content = m.reasoning_content;
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id ?? `call_${tc.tool}`,
          type: "function" as const,
          function: { name: tc.tool, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      result.push(msg);
    } else if (m.role === "tool" && m.tool_call_id) {
      result.push({
        role: "tool",
        content: m.content,
        tool_call_id: m.tool_call_id,
      });
    }
  }
  return result;
}
