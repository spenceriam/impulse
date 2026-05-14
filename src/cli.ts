#!/usr/bin/env node
/**
 * Impulse CLI — provider smoke-test runner
 *
 * Usage:
 *   bun run src/cli.ts                          # interactive (uses config default provider)
 *   bun run src/cli.ts "Say hi"                 # single prompt
 *   bun run src/cli.ts -m "openrouter/claude-haiku-4.5" "Say hi"
 *   bun run src/cli.ts --setup                  # interactive API key setup
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getProviderManager, resetProviderManager } from "./api/manager";
import { load as loadConfig, save as saveConfig } from "./util/config";
import type { Config } from "./util/config";

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
  return process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
}

function homeEnvPath(): string {
  return path.join(homeDir(), ".impulse", ".env");
}

function loadEnv() {
  const pEnv = projectRootEnv();
  if (pEnv) { loadDotenv(pEnv); return; }
  const hEnv = homeEnvPath();
  if (fs.existsSync(hEnv)) loadDotenv(hEnv);
}

loadEnv();

// ---------------------------------------------------------------------------
// Key check (any known provider key present)
// ---------------------------------------------------------------------------
function hasAnyKey(): boolean {
  const keys = [
    "ZAI_API_KEY", "GLM_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY",
    "OLLAMA_API_KEY",
  ];
  return keys.some((k) => (process.env[k] ?? "").length > 5);
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
  console.log("Choose a provider to configure:\n");
  console.log("  1. Ollama Cloud  (https://ollama.com)");
  console.log("  2. OpenRouter    (https://openrouter.ai)");
  console.log("  3. Z.ai          (https://api.z.ai)\n");

  const choice = await ask("Provider [1/2/3]: ");

  let providerKey: string;
  let envVar: string;
  let label: string;
  let keyHint: string;
  let baseUrlPrompt: string | null = null;

  switch (choice) {
    case "2":
      providerKey = "openrouter";
      envVar = "OPENROUTER_API_KEY";
      label = "OpenRouter";
      keyHint = "sk-or-v1-...";
      break;
    case "3":
      providerKey = "z.ai";
      envVar = "ZAI_API_KEY";
      label = "Z.ai";
      keyHint = "your Z.ai API key";
      break;
    default:
      providerKey = "ollama";
      envVar = "OLLAMA_API_KEY";
      label = "Ollama Cloud";
      keyHint = "your Ollama API key";
      baseUrlPrompt = "Ollama endpoint URL";
      break;
  }

  let baseUrl: string | undefined;
  if (baseUrlPrompt !== null) {
    baseUrl = await ask(`${baseUrlPrompt} [https://ollama.com]: `);
    if (!baseUrl) baseUrl = "https://ollama.com";
  }

  const key = await ask(`Enter your ${label} API key (${keyHint}): `);
  if (!key) {
    console.log("\nNo key entered. Aborting.");
    iface.close();
    process.exit(1);
  }

  // Ensure ~/.impulse/ directory exists
  const dir = path.join(homeDir(), ".impulse");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Persist to config file
  const cfg: Config = await loadConfig().catch((): Config => ({
    providers: {},
    defaultProvider: providerKey,
    defaultModel: providerKey === "ollama" ? "ollama/llama3.2" : `${providerKey}/default`,
    defaultMode: "AGENT",
    thinking: true,
    reasoningLevel: "medium",
    maxOutputTokens: 32000,
    hasSeenWelcome: false,
  }));

  cfg.providers[providerKey as keyof Config["providers"]] = {
    apiKey: key,
    ...(baseUrl ? { baseUrl } : {}),
  };
  cfg.defaultProvider = providerKey;
  process.env[envVar] = key;

  await saveConfig(cfg);
  resetProviderManager();

  // Also write ~/.impulse/.env
  const envLines = [`${envVar}=${key}`, ...(baseUrl ? [`OLLAMA_BASE_URL=${baseUrl}`] : [])];
  fs.writeFileSync(homeEnvPath(), envLines.join("\n") + "\n", { mode: 0o600 });

  console.log(`\n✅ ${label} key saved.`);
  if (baseUrl) console.log(`✅ Endpoint: ${baseUrl}`);
  console.log("Run `bun run src/cli.ts` to start.\n");

  iface.close();
}

// ---------------------------------------------------------------------------
// Streaming helper
// ---------------------------------------------------------------------------
async function chat(model: string, prompt: string): Promise<void> {
  const manager = await getProviderManager();
  const stream = manager.stream({
    model,
    messages: [{ role: "user", content: prompt }],
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) process.stdout.write(delta.content);
  }
  if (!process.stdout.isTTY) process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--setup")) { await runSetup(); return; }

  if (!hasAnyKey()) {
    console.log("\nNo provider API key found.");
    await runSetup();
    return;
  }

  const config = await loadConfig();
  let model = config.defaultModel ?? "ollama/llama3.2";
  let prompt = "";

  if (args.length > 0) {
    const mi = args.indexOf("-m");
    if (mi >= 0 && args[mi + 1] !== undefined) {
      model = args[mi + 1]!;
      prompt = args.slice(mi + 2).join(" ");
    } else {
      prompt = args.join(" ");
    }
  }

  if (!prompt) {
    console.log(`\n=== IMPULSE CLI ===`);
    console.log(`provider: ${config.defaultProvider}  model: ${model}`);
    console.log("Type a prompt, or 'quit' to exit.\n");

    const rl = await import("readline");
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

    const go = () => {
      iface.question("> ", (a) => {
        if (a.toLowerCase() === "quit" || a.toLowerCase() === "exit") {
          iface.close(); process.exit(0); return;
        }
        chat(model, a)
          .then(() => console.log("\n"))
          .catch((e: unknown) => console.error("\nError:", e))
          .then(go);
      });
    };
    iface.on("close", () => process.exit(0));
    go();
    await new Promise<void>(() => {}); // keep alive
    return;
  }

  await chat(model, prompt);
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
