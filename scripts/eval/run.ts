#!/usr/bin/env bun
/**
 * Internal tool-heavy eval harness — checkpointed prompts per provider/model.
 *
 * Usage:
 *   bun scripts/eval/run.ts
 *   bun scripts/eval/run.ts --model ollama/glm-4.7
 */

import { buildChatMessages } from "../../src/agent/build-chat-messages.js";
import { isImpulseUiMessage } from "../../src/session/status-events.js";
import type { Message } from "../../src/session/store.js";

const CHECKPOINTS: Array<{ name: string; messages: Message[] }> = [
  {
    name: "status-events-excluded",
    messages: [
      {
        role: "system",
        content: "[impulse_ui] Mode changed to EXPLORE",
        timestamp: new Date().toISOString(),
      },
      { role: "user", content: "hello", timestamp: new Date().toISOString() },
    ],
  },
  {
    name: "tool-continuation-shape",
    messages: [
      { role: "user", content: "read package.json", timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        tool_calls: [
          {
            id: "call_1",
            tool: "file_read",
            arguments: { path: "package.json" },
          },
        ],
      },
      {
        role: "tool" as "user",
        content: '{"name":"impulse"}',
        timestamp: new Date().toISOString(),
        tool_call_id: "call_1",
      } as unknown as Message,
    ],
  },
];

function parseModelArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--model");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

let passed = 0;
let failed = 0;

for (const cp of CHECKPOINTS) {
  try {
    if (cp.name === "status-events-excluded") {
      const ui = cp.messages.find((m) => isImpulseUiMessage(m));
      if (!ui) throw new Error("missing ui message");
      const api = buildChatMessages(cp.messages, "system");
      if (api.length !== 2) throw new Error(`expected 2 api msgs, got ${api.length}`);
    }
    if (cp.name === "tool-continuation-shape") {
      const api = buildChatMessages(cp.messages, "system");
      const roles = api.map((m) => m.role).join(",");
      if (!roles.includes("tool")) throw new Error(`missing tool role: ${roles}`);
    }
    console.log(`  [ok] ${cp.name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [fail] ${cp.name}: ${msg}`);
    failed++;
  }
}

const model = parseModelArg(process.argv.slice(2));
if (model) {
  console.log(`(model ${model} — live API eval not configured in CI; structure checks only)`);
}

console.log(`\nEval: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
