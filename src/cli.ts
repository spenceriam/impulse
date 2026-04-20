#!/usr/bin/env node
/**
 * Impulse CLI — minimal provider test runner
 *
 * Usage:
 *   npx tsx src/cli.ts                                # interactive mode (default: claude-haiku-4.5 via OpenRouter)
 *   npx tsx src/cli.ts "Say hi"                       # single prompt
 *   npx tsx src/cli.ts -m "anthropic/claude-3.5-haiku" "Say hi"
 */

import { OpenRouterProvider } from "./api/providers/openrouter";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Portable .env loader
// ---------------------------------------------------------------------------

function projectRootEnv(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  let dir = path.dirname(__filename);
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, ".env");
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  return null;
}

function loadDotenv(filePath: string) {
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#") && t.includes("=")) {
      const i = t.indexOf("=");
      process.env[t.substring(0, i).trim()] = t.substring(i + 1).trim();
    }
  }
}

// Load config: project root .env > ~/.impulse/.env
const pEnv = projectRootEnv();
if (pEnv) {
  loadDotenv(pEnv);
} else {
  const homeEnv = path.join(process.env.HOME || process.env.USERPROFILE || "", ".impulse", ".env");
  if (fs.existsSync(homeEnv)) loadDotenv(homeEnv);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ask(provider: OpenRouterProvider, model: string, prompt: string): Promise<void> {
  const stream = provider.stream(
    { messages: [{ role: "user", content: prompt }], model: model },
    {},
  );
  for await (const chunk of stream) {
    if (chunk.content) process.stdout.write(chunk.content);
  }
  if (!process.stdout.isTTY) process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let model = "anthropic/claude-haiku-4.5";
  let prompt = "";

  if (args.length > 0) {
    const mi = args.indexOf("-m");
    if (mi >= 0 && args[mi + 1]) {
      model = args[mi + 1];
      prompt = args.slice(mi + 2).join(" ");
    } else {
      prompt = args.join(" ");
    }
  }

  let provider: OpenRouterProvider;
  try {
    provider = new OpenRouterProvider();
  } catch (e) {
    console.error("OpenRouterProvider init error:", e);
    process.exit(1);
  }

  // Interactive mode if no prompt given
  if (!prompt) {
    console.log("\n=== IMPULSE (OpenRouter) ===");
    console.log(`model: ${model}`);
    console.log("Type a prompt, or 'quit' to exit.\n");

    const rl = await import("readline");
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

    const go = () => {
      iface.question("> ", (a) => {
        if (a.toLowerCase() === "quit" || a.toLowerCase() === "exit") {
          iface.close();
          process.exit(0);
          return;
        }
        ask(provider, model, a)
          .then(() => console.log("\n"))
          .catch((e) => console.error("\nError:", e))
          .then(go);
      });
    };
    iface.on("close", () => process.exit(0));
    go();
    await new Promise<void>(() => {}); // keep alive
    return;
  }

  // Single prompt
  await ask(provider, model, prompt);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
