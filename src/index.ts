#!/usr/bin/env node
/**
 * Impulse — CLI coding agent entry point
 *
 * Usage:
 *   impulse                  # start interactive session
 *   impulse "fix the bug"    # single-turn then interactive
 *   impulse --setup          # run provider onboarding
 *   impulse --version
 */

import { registerCrashRecoveryHandlers } from "./util/crash-recovery.js";
import { load as loadConfig, save as saveConfig } from "./util/config.js";
import { resetProviderManager } from "./api/manager.js";
import { testOllamaConnection } from "./api/providers/ollama.js";
import "./tools/init.js";
import { ImpulseRenderer } from "./cli/renderer.js";
import packageJson from "../package.json";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

registerCrashRecoveryHandlers();

const args = process.argv.slice(2);

// ─── --version ───────────────────────────────────────────────────────────────
if (args.includes("--version") || args.includes("-v")) {
  console.log(packageJson.version);
  process.exit(0);
}

// ─── --help ──────────────────────────────────────────────────────────────────
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  impulse v${packageJson.version}
  Provider-flexible CLI coding agent.

  Usage:
    impulse                   Start interactive session
    impulse "your message"    Send a single message then enter interactive
    impulse --setup           Configure AI provider
    impulse --version         Show version
`);
  process.exit(0);
}

// ─── --setup ─────────────────────────────────────────────────────────────────
if (args.includes("--setup")) {
  await runSetup();
  process.exit(0);
}

// ─── Check if any provider is configured ────────────────────────────────────
const config = await loadConfig();
const hasProvider = (
  config.providers?.ollama?.apiKey ||
  config.providers?.ollama?.baseUrl ||
  config.providers?.openrouter?.apiKey ||
  config.providers?.["z.ai"]?.apiKey ||
  config.providers?.openai?.apiKey ||
  config.providers?.groq?.apiKey ||
  config.providers?.gemini?.apiKey ||
  process.env["OLLAMA_API_KEY"] ||
  process.env["OPENROUTER_API_KEY"] ||
  process.env["OPENAI_API_KEY"] ||
  process.env["ZAI_API_KEY"] ||
  process.env["GLM_API_KEY"]
);

if (!hasProvider) {
  console.log("\n  No provider configured. Running setup…\n");
  await runSetup();
}

// ─── Check if user profile exists ─────────────────────────────────────────────
const currentConfig = await loadConfig();
if (!currentConfig.userProfile?.name) {
  await runOnboarding();
}

// ─── Init tools & start ──────────────────────────────────────────────────────
// Tools registered via side-effect import above
const renderer = new ImpulseRenderer();
await renderer.start();

// ─────────────────────────────────────────────────────────────────────────────
// First-run setup
// ─────────────────────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));

  console.log(`
  \x1b[1mImpulse Setup\x1b[0m
  \x1b[90m─────────────────────────────────────────\x1b[0m
  Choose a provider:

    1. Ollama Cloud   \x1b[90m(https://ollama.com)\x1b[0m
    2. OpenRouter     \x1b[90m(https://openrouter.ai)\x1b[0m
    3. OpenAI         \x1b[90m(https://platform.openai.com)\x1b[0m
    4. Z.ai           \x1b[90m(https://api.z.ai)\x1b[0m
    5. Groq           \x1b[90m(https://console.groq.com)\x1b[0m
`);

  const choice = await ask("  Provider [1-5]: ");

  let providerKey: string;
  let envVar: string;
  let label: string;
  let defaultModel: string;
  let needsBaseUrl = false;

  switch (choice) {
    case "2": providerKey = "openrouter"; envVar = "OPENROUTER_API_KEY"; label = "OpenRouter";
              defaultModel = "openrouter/anthropic/claude-haiku-4.5"; break;
    case "3": providerKey = "openai";     envVar = "OPENAI_API_KEY";     label = "OpenAI";
              defaultModel = "openai/gpt-4o-mini"; break;
    case "4": providerKey = "z.ai";       envVar = "ZAI_API_KEY";        label = "Z.ai";
              defaultModel = "z.ai/glm-4.7"; break;
    case "5": providerKey = "groq";       envVar = "GROQ_API_KEY";       label = "Groq";
              defaultModel = "groq/llama-3.3-70b-versatile"; break;
    default:  providerKey = "ollama";     envVar = "OLLAMA_API_KEY";     label = "Ollama Cloud";
              defaultModel = "ollama/llama3.2"; needsBaseUrl = true; break;
  }

  let baseUrl: string | undefined;
  if (needsBaseUrl) {
    const entered = await ask(`  Endpoint URL [https://ollama.com]: `);
    baseUrl = entered || "https://ollama.com";
  }

  const key = await ask(`  ${label} API key: `);
  if (!key) { console.log("  No key entered — aborting."); rl.close(); return; }

  // Test connection for Ollama
  if (providerKey === "ollama") {
    process.stdout.write("  Testing connection…");
    const result = await testOllamaConnection(baseUrl ?? "https://ollama.com", key);
    if (result.success) {
      console.log(` \x1b[32m✓\x1b[0m  ${result.message}`);
      if (result.models.length > 0) {
        console.log(`\n  Available models:`);
        result.models.slice(0, 10).forEach((m, i) => console.log(`    ${i + 1}. ${m}`));
        if (result.models.length > 10) console.log(`    … and ${result.models.length - 10} more`);

        const modelChoice = await ask(`\n  Pick a model (number or full name) [1]: `);
        const idx = parseInt(modelChoice) - 1;
        if (!isNaN(idx) && result.models[idx]) {
          defaultModel = `ollama/${result.models[idx]}`;
        } else if (modelChoice && !modelChoice.match(/^\d+$/)) {
          defaultModel = modelChoice.startsWith("ollama/") ? modelChoice : `ollama/${modelChoice}`;
        }
      }
    } else {
      console.log(` \x1b[33m⚠\x1b[0m  ${result.message}`);
      console.log("  Saving config anyway — you can fix the endpoint later with --setup.\n");
    }
  }

  // Save config
  const cfg = await loadConfig().catch(() => ({
    providers: {} as Record<string, unknown>,
    defaultProvider: providerKey,
    defaultModel,
    defaultMode: "WORK",
    thinking: true,
    hasSeenWelcome: true,
  }));

  const providers = cfg.providers as Record<string, unknown>;
  providers[providerKey] = { apiKey: key, ...(baseUrl ? { baseUrl } : {}) };
  cfg.defaultProvider = providerKey;
  cfg.defaultModel = defaultModel;
  process.env[envVar] = key;

  await saveConfig(cfg as Parameters<typeof saveConfig>[0]);
  resetProviderManager();

  // Save to ~/.impulse/.env
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const impulseDir = path.join(homeDir, ".impulse");
  if (!fs.existsSync(impulseDir)) fs.mkdirSync(impulseDir, { recursive: true });
  const envLines = [`${envVar}=${key}`, ...(baseUrl ? [`OLLAMA_BASE_URL=${baseUrl}`] : [])];
  fs.writeFileSync(path.join(impulseDir, ".env"), envLines.join("\n") + "\n", { mode: 0o600 });

  console.log(`\n  \x1b[32m✓\x1b[0m  Saved. Default model: ${defaultModel}\n`);
  rl.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// User onboarding
// ─────────────────────────────────────────────────────────────────────────────

export async function runOnboarding(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));

  console.log(`
  \x1b[1mWelcome to Impulse\x1b[0m
  \x1b[90m─────────────────────────────────────────\x1b[0m
  Let's personalize your experience.
`);

  const name = await ask("  What's your name? ");
  if (!name) {
    console.log("  No name entered — skipping onboarding.");
    rl.close();
    return;
  }

  console.log(`
  How should Impulse respond to you?

    1. Concise    \x1b[90m(short, direct answers)\x1b[0m
    2. Detailed   \x1b[90m(thorough explanations)\x1b[0m
    3. Casual     \x1b[90m(relaxed, friendly tone)\x1b[0m
    4. Technical   \x1b[90m(precise, code-focused)\x1b[0m
    5. Other       \x1b[90m(describe your preference)\x1b[0m
`);

  const prefChoice = await ask("  Choice [1]: ");
  let responsePreference: string;

  switch (prefChoice) {
    case "2":
      responsePreference = "detailed";
      break;
    case "3":
      responsePreference = "casual";
      break;
    case "4":
      responsePreference = "technical";
      break;
    case "5": {
      const custom = await ask("  Describe your preferred style: ");
      responsePreference = custom || "concise";
      break;
    }
    default:
      responsePreference = "concise";
  }

  console.log(`
  \x1b[90mCustom instructions are injected into every session's system prompt.
  Leave blank to skip.\x1b[0m
`);
  const customInstructions = await ask("  Any custom instructions? (optional): ");

  // Load config and save user profile
  const cfg = await loadConfig().catch(() => ({
    providers: {} as Record<string, unknown>,
    defaultProvider: "ollama",
    defaultModel: "ollama/llama3.2",
    defaultMode: "WORK",
    thinking: true,
    hasSeenWelcome: true,
    userProfile: {
      name: "",
      responsePreference: "concise",
      customInstructions: "",
    },
  }));

  cfg.userProfile = {
    name,
    responsePreference,
    customInstructions: customInstructions || "",
  };
  cfg.hasSeenWelcome = true;

  await saveConfig(cfg as Parameters<typeof saveConfig>[0]);

  console.log(`\n  \x1b[32m✓\x1b[0m  Welcome, ${name}! Your preferences have been saved.\n`);
  rl.close();
}
