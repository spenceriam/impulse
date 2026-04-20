#!/usr/bin/env node
/**
 * Impulse CLI — minimal provider test runner
 *
 * Usage:
 *   npx tsx src/cli.ts                                # interactive mode (default: claude-haiku-4.5 via OpenRouter)
 *   npx tsx src/cli.ts "Say hi"                       # single prompt
 *   npx tsx src/cli.ts -m "anthropic/claude-3.5-haiku" "Say hi"
 *   npx tsx src/cli.ts --setup                        # interactive API key setup
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

function loadConfig() {
  const pEnv = projectRootEnv();
  if (pEnv) {
    loadDotenv(pEnv);
    return;
  }
  const hEnv = homeEnvPath();
  if (fs.existsSync(hEnv)) {
    loadDotenv(hEnv);
  }
}

loadConfig();

// ---------------------------------------------------------------------------
// Key check
// ---------------------------------------------------------------------------
function hasKey(): boolean {
  return !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.length > 10);
}

// ---------------------------------------------------------------------------
// First-run onboarding
// ---------------------------------------------------------------------------
async function runSetup(): Promise<void> {
  const rl = await import("readline");
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => iface.question(q, (a) => res(a.trim())));

  console.log("\n=== IMPULSE Setup ===\n");
  console.log("Impulse uses OpenRouter for AI model inference.");
  console.log("Get a free key at: https://openrouter.ai/keys\n");

  const key = await ask("Enter your OpenRouter API key (sk-or-v1-...): ");

  if (!key || key.toLowerCase().startsWith("sk-or-v1-") === false) {
    console.log("\nThat doesn't look like a valid OpenRouter key. Aborting.");
    iface.close();
    process.exit(1);
  }

  // Ensure ~/.impulse/ directory exists
  const dir = path.join(homeDir(), ".impulse");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write key to ~/.impulse/.env
  const envPath = homeEnvPath();
  const envContent = `# Impulse CLI — OpenRouter API Key\nOPENROUTER_API_KEY=${key}\n`;
  fs.writeFileSync(envPath, envContent, { mode: 0o600 });

  // Also write project-local .env if repo has one
  const projectEnv = projectRootEnv();
  if (projectEnv) {
    fs.writeFileSync(projectEnv, `OPENROUTER_API_KEY=${key}\n`, { mode: 0o600 });
  }

  process.env.OPENROUTER_API_KEY = key;
  console.log("\n✅ Key saved to ~/.impulse/.env");
  if (projectEnv) console.log(`✅ Key also saved to ${projectEnv}`);
  console.log("\nYou're all set. Run `npx tsx src/cli.ts` to start.\n");

  iface.close();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function askProvider(provider: OpenRouterProvider, model: string, prompt: string): Promise<void> {
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

  // --setup flag: run onboarding
  if (args.includes("--setup")) {
    await runSetup();
    return;
  }

  // No key found — run setup automatically on first run
  if (!hasKey()) {
    console.log("\nNo OpenRouter API key found.");
    await runSetup();
    return;
  }

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

  const provider = new OpenRouterProvider();

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
        askProvider(provider, model, a)
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
  await askProvider(provider, model, prompt);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
