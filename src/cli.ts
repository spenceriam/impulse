#!/usr/bin/env node
/**
 * Impulse CLI — minimal provider test runner
 *
 * Usage:
 *   npx tsx src/cli.ts                                # interactive mode
 *   npx tsx src/cli.ts "Say hi"                       # single prompt (default model)
 *   npx tsx src/cli.ts -m "openai/gpt-4o" "Say hi"   # specify model
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

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

function homeEnvPath(): string {
  return path.join(homeDir(), ".impulse", ".env");
}

// Load config: project root .env > ~/.impulse/.env
const pEnv = projectRootEnv();
if (pEnv) {
  loadDotenv(pEnv);
} else {
  const hEnv = homeEnvPath();
  if (fs.existsSync(hEnv)) loadDotenv(hEnv);
}

// ---------------------------------------------------------------------------
// First-run onboarding
// ---------------------------------------------------------------------------

async function onboard(): Promise<void> {
  console.log("\n  Welcome to Impulse");
  console.log("  ───────────────────");
  console.log("  No OpenRouter API key found.");
  console.log("  Get one at: https://openrouter.ai/keys\n");

  const rl = await import("readline");
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

  const key = await new Promise<string>((resolve) => {
    iface.question("  Enter your OpenRouter API key: ", (answer) => {
      resolve(answer.trim());
    });
  });

  if (!key || key.length < 10) {
    console.log("\n  Invalid key. Exiting.\n");
    process.exit(1);
  }

  // Create ~/.impulse/ and write .env
  const dir = path.dirname(homeEnvPath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(homeEnvPath(), `OPENROUTER_API_KEY=${key}\n`);

  // Mask loaded key from env
  fs.chmodSync(homeEnvPath(), 0o600);

  console.log("\n  ✓ Config saved to ~/.impulse/.env");
  console.log("  You can edit it later with: nano ~/.impulse/.env\n");

  iface.close();
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
  // Check if we have a key
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  if (!hasKey) {
    await onboard();
    // Reload after onboarding
    loadDotenv(homeEnvPath());
  }

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
    await new Promise<void>(() => {});
    return;
  }

  await ask(provider, model, prompt);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
