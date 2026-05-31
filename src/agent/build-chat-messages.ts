import type { ChatMessage } from "../api/types.js";
import type { Message } from "../session/store.js";

/** Build provider chat messages from session history (includes preserved reasoning). */
export function buildChatMessages(
  sessionMessages: Message[],
  systemPrompt: string
): ChatMessage[] {
  const result: ChatMessage[] = [{ role: "system", content: systemPrompt }];
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
    } else if (m.role === "tool" as string) {
      const toolMsg = m as unknown as {
        role: "tool";
        content: string;
        tool_call_id: string;
      };
      result.push({
        role: "tool",
        content: toolMsg.content,
        tool_call_id: toolMsg.tool_call_id,
      });
    }
  }
  return result;
}
