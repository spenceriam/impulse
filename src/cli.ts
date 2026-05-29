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
import { createDefaultConfig, load as loadConfig, save as saveConfig } from "./util/config";
import type { Config } from "./util/config";
import { testOllamaConnection } from "./api/providers/ollama.js";
import { discoverModels } from "./cli/model-setup.js";

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

  console.log("\n=== impulse Setup ===\n");
  console.log("Choose a provider to configure:\n");
  console.log("  1. Ollama Cloud  (https://ollama.com)");
  console.log("  2. OpenRouter    (https://openrouter.ai)");
  console.log("  3. Custom (OpenAI-compatible)");
  console.log("  4. Custom (Anthropic-compatible)\n");

  const choice = await ask("Provider [1/2/3/4]: ");

  let providerKey = "";
  let envVar: string;
  let label: string;
  let keyHint: string;
  let baseUrlPrompt: string | null = null;
  let isCustom = false;
  let customType: "openai-compatible" | "anthropic-compatible" | undefined;

  switch (choice) {
    case "2":
      providerKey = "openrouter";
      envVar = "OPENROUTER_API_KEY";
      label = "OpenRouter";
      keyHint = "sk-or-v1-...";
      break;
    case "3":
      isCustom = true;
      customType = "openai-compatible";
      envVar = "";
      label = "Custom (OpenAI)";
      keyHint = "your API key";
      break;
    case "4":
      isCustom = true;
      customType = "anthropic-compatible";
      envVar = "";
      label = "Custom (Anthropic)";
      keyHint = "sk-ant-...";
      break;
    default:
      providerKey = "ollama";
      envVar = "OLLAMA_API_KEY";
      label = "Ollama Cloud";
      keyHint = "your Ollama API key";
      baseUrlPrompt = "Ollama endpoint URL";
      break;
  }

  if (isCustom) {
    const name = await ask("Provider name (slug, e.g. my-llm): ");
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      console.log("\nInvalid or empty name. Aborting.");
      iface.close();
      process.exit(1);
    }
    providerKey = name;
  }

  let baseUrl: string | undefined;
  if (baseUrlPrompt !== null) {
    baseUrl = await ask(`${baseUrlPrompt} [https://ollama.com]: `);
    if (!baseUrl) baseUrl = "https://ollama.com";
  } else if (isCustom) {
    const defaultUrl = customType === "anthropic-compatible" ? "https://api.anthropic.com/v1" : "";
    const prompt = defaultUrl ? `Endpoint URL [${defaultUrl}]: ` : "Endpoint URL: ";
    baseUrl = await ask(prompt);
    if (!baseUrl && defaultUrl) baseUrl = defaultUrl;
    if (!baseUrl) {
      console.log("\nNo endpoint URL entered. Aborting.");
      iface.close();
      process.exit(1);
    }
  }

  const key = await ask(`Enter your ${label} API key (${keyHint}): `);
  if (!key) {
    console.log("\nNo key entered. Aborting.");
    iface.close();
    process.exit(1);
  }

  let defaultModel = `${providerKey}/default`;

  // Test connection for Ollama
  if (providerKey === "ollama") {
    process.stdout.write("Testing connection…");
    const result = await testOllamaConnection(baseUrl ?? "https://ollama.com", key);
    if (result.success) {
      console.log(` OK — ${result.models.length} models found`);
      if (result.models.length > 0) {
        console.log("\nAvailable models:");
        result.models.slice(0, 10).forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
        if (result.models.length > 10) console.log(`  … and ${result.models.length - 10} more`);
        const modelChoice = await ask("\nPick a model (number or full name) [1]: ");
        const idx = parseInt(modelChoice) - 1;
        if (!isNaN(idx) && result.models[idx]) {
          defaultModel = `ollama/${result.models[idx]}`;
        } else if (modelChoice && !modelChoice.match(/^\d+$/)) {
          defaultModel = modelChoice.startsWith("ollama/") ? modelChoice : `ollama/${modelChoice}`;
        }
      }
    } else {
      console.log(` FAIL — ${result.message}`);
    }
  } else if (isCustom) {
    process.stdout.write("Discovering models…");
    try {
      const customProv: Parameters<typeof discoverModels>[0] = {
        key: providerKey,
        label,
        envVar: "",
        defaultModel,
        modelBaseUrl: baseUrl ?? "",
        ...(baseUrl ? { defaultBaseUrl: baseUrl } : {}),
        needsBaseUrl: true,
        isCustom: true,
        ...(customType ? { customType } : {}),
      };
      const discovery = await discoverModels(customProv, key, baseUrl);
      if (discovery.success && discovery.models.length > 0) {
          console.log(` OK — ${discovery.models.length} models found`);
          console.log("\nAvailable models:");
          discovery.models.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));const modelChoice = await ask("\nPick a model (number or full name) [1]: ");
          const idx = parseInt(modelChoice) - 1;
          if (!isNaN(idx) && discovery.models[idx]) {
            defaultModel = `${providerKey}/${discovery.models[idx]}`;
          } else if (modelChoice && !modelChoice.match(/^\d+$/)) {
            defaultModel = modelChoice.includes("/") ? modelChoice : `${providerKey}/${modelChoice}`;
          }
        } else {
          console.log(` FAIL — ${discovery.message}`);
          const manual = await ask("Enter model ID manually: ");
          if (manual) {
            defaultModel = manual.includes("/") ? manual : `${providerKey}/${manual}`;
          }
        }
    } catch {
      console.log(" FAIL");
    }
  }

  // Ensure ~/.impulse/ directory exists
  const dir = path.join(homeDir(), ".impulse");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Persist to config file
  const cfg = await loadConfig().catch(() =>
    createDefaultConfig({
      providers: {},
      defaultProvider: providerKey,
      defaultModel,
      modelExplicitlySet: Boolean(defaultModel?.trim()),
      hasSeenWelcome: false,
    })
  );

  cfg.providers[providerKey as keyof Config["providers"]] = {
    apiKey: key,
    ...(baseUrl ? { baseUrl } : {}),
    ...(customType ? { type: customType } as any : {}),
  };
  cfg.defaultProvider = providerKey;
  cfg.defaultModel = defaultModel;
  cfg.modelExplicitlySet = true;
  if (envVar) process.env[envVar] = key;

  await saveConfig(cfg);
  resetProviderManager();

  // Also write ~/.impulse/.env
  const envLines = [...(envVar ? [`${envVar}=${key}`] : []), ...(baseUrl && providerKey === "ollama" ? [`OLLAMA_BASE_URL=${baseUrl}`] : [])];
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
    console.log(`\n=== impulse CLI ===`);
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
