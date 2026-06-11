/**
 * Session statistics for /usage and statsOnExit summary.
 */

import type { Session } from "./store.js";

export interface SessionStats {
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolSuccess: number;
  toolFailed: number;
  toolsByName: Record<string, number>;
  estimatedTokens: number;
  cacheReadTokens: number;
  durationMs: number;
}

export function collectSessionStats(session: Session): SessionStats {
  const toolsByName: Record<string, number> = {};
  let toolCalls = 0;
  let toolSuccess = 0;
  let toolFailed = 0;
  let userMessages = 0;
  let assistantMessages = 0;

  for (const msg of session.messages) {
    if (msg.role === "user") userMessages++;
    if (msg.role === "assistant") {
      assistantMessages++;
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCalls++;
          const name = tc.tool ?? "unknown";
          toolsByName[name] = (toolsByName[name] ?? 0) + 1;
        }
      }
    }
    if (msg.role === "tool") {
      const content = msg.content ?? "";
      if (content.includes("[FAIL]") || content.toLowerCase().includes("error")) {
        toolFailed++;
      } else {
        toolSuccess++;
      }
    }
  }

  const estimatedTokens = Math.ceil(JSON.stringify(session.messages).length / 4);
  const cacheReadRaw = session.metadata?.["cacheReadTokens"];
  const cacheReadTokens =
    typeof cacheReadRaw === "number" && Number.isFinite(cacheReadRaw) ? cacheReadRaw : 0;
  const created = Date.parse(session.created_at);
  const updated = Date.parse(session.updated_at);
  const durationMs =
    Number.isFinite(created) && Number.isFinite(updated)
      ? Math.max(0, updated - created)
      : 0;

  return {
    messageCount: session.messages.length,
    userMessages,
    assistantMessages,
    toolCalls,
    toolSuccess,
    toolFailed,
    toolsByName,
    estimatedTokens,
    cacheReadTokens,
    durationMs,
  };
}

export function formatSessionStatsBlock(stats: SessionStats): string[] {
  const duration =
    stats.durationMs >= 3_600_000
      ? `${Math.floor(stats.durationMs / 3_600_000)}h ${Math.floor((stats.durationMs % 3_600_000) / 60_000)}m`
      : stats.durationMs >= 60_000
        ? `${Math.floor(stats.durationMs / 60_000)}m ${Math.floor((stats.durationMs % 60_000) / 1000)}s`
        : `${Math.floor(stats.durationMs / 1000)}s`;

  const toolBreakdown = Object.entries(stats.toolsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${name}: ${count}`)
    .join("  ");

  const lines = [
    "───────────────────────────────────────────────────────────────────",
    `  Tools     ${stats.toolCalls} calls  ${stats.toolSuccess} success  ${stats.toolFailed} failed`,
  ];
  if (toolBreakdown) {
    lines.push(`            ${toolBreakdown}`);
  }
  lines.push(`  Tokens    ~${stats.estimatedTokens.toLocaleString()} estimated`);
  if (stats.cacheReadTokens > 0) {
    lines.push(`  Cache read ${stats.cacheReadTokens.toLocaleString()}`);
  }
  lines.push(
    `  Messages  ${stats.messageCount} (${stats.userMessages} user, ${stats.assistantMessages} assistant)`,
    `  Duration  ${duration}`,
    "───────────────────────────────────────────────────────────────────"
  );
  return lines;
}
