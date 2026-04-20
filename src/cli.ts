#!/usr/bin/env node
/** Minimal CLI for testing Impulse provider manager */

import { getProviderManager } from "./api/manager";
import { AIStreamResponse } from "./api/provider";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load .env from the project root
const envPath = '/tmp/impulse/.env';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > -1) {
        const key = trimmed.substring(0, eqIndex).trim();
        const val = trimmed.substring(eqIndex + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

async function testProviderManager(model: string): Promise<void> {
  try {
    console.log(`\nTesting provider manager with model: ${model}`);

    // Get the provider manager
    const manager = await getProviderManager();
    console.log("Provider manager initialized");

    // Test streaming — use the actual model string
    console.log("\n--- Sending: 'Say pong, nothing else' ---\n");
    const stream = await manager.stream({
      messages: [{ role: "user", content: "Say pong, nothing else" }],
      model: model,
      thinking: false,
    });

    // Consume the stream
    for await (const chunk of stream) {
      if (chunk.content) {
        console.log(chunk.content);
      }
      if (chunk.done) break;
    }

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // Interactive mode
    console.log("\n=== IMPULSE (OpenRouter / Claude Haiku 4.5) ===");
    console.log("Type a prompt, or 'quit' to exit.\n");
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const manager = await getProviderManager();
    let active = false;

    const ask = () => {
      active = false;
      rl.question('> ', async (answer) => {
        if (answer.toLowerCase() === 'quit' || answer.toLowerCase() === 'exit') {
          rl.close();
          return;
        }
        try {
          const stream = await manager.stream({
            messages: [{ role: "user", content: answer }],
            model: "openrouter/anthropic/claude-haiku-4.5",
            thinking: false,
          });
          for await (const chunk of stream) {
            if (chunk.content) process.stdout.write(chunk.content);
          }
          console.log("\n");
        } catch (e) {
          console.error("\nError:", e);
        }
        ask();
      });
      active = true;
    };
    rl.on('close', () => {});
    ask();
    // Keep process alive
    await new Promise<void>(() => {});
  }
  // Single prompt mode
  const model = args.length > 0 ? args.join(' ') : "openrouter/anthropic/claude-haiku-4.5";
  await testProviderManager(model);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
