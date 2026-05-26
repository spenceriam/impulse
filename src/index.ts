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
import {
  load as loadConfig,
  save as saveConfig,
  invalidateConfigCache,
} from "./util/config.js";
import { resetProviderManager } from "./api/manager.js";
import { testOllamaConnection } from "./api/providers/ollama.js";
import { discoverModels } from "./cli/model-setup.js";
import "./tools/init.js";
import { ImpulseRenderer, type ResumeStartup } from "./cli/renderer.js";
import { migrateHomeIfNeeded } from "./session/migrate-home.js";
import { enrichSessionTitles } from "./session/enrich-titles.js";
import { summarizeSessions } from "./session/session-content.js";
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
    impulse -r, --resume      Resume session (picker)
    impulse --resume <id>     Resume session by id
    impulse --setup                   Configure AI provider
    impulse --enrich-session-titles Backfill AI titles on saved sessions
    impulse --list-sessions           Count sessions (total, empty, titled)
    impulse --version                 Show version
`);
  process.exit(0);
}

function parseProjectScopeArg(argv: string[]): "all" | "current" {
  const projectIdx = argv.indexOf("--project");
  if (projectIdx >= 0 && argv[projectIdx + 1] === "current") {
    return "current";
  }
  return "all";
}

function parseEnrichSessionTitlesArgs(argv: string[]): {
  projectScope: "all" | "current";
  limit?: number;
  dryRun: boolean;
} {
  let projectScope = parseProjectScopeArg(argv);
  let limit: number | undefined;
  const limitIdx = argv.indexOf("--limit");
  if (limitIdx >= 0) {
    const n = Number.parseInt(argv[limitIdx + 1] ?? "", 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }
  const dryRun = argv.includes("--dry-run");
  return { projectScope, limit, dryRun };
}

function parseResumeArg(argv: string[]): ResumeStartup | undefined {
  const resumeIdx = argv.findIndex((a) => a === "--resume" || a === "-r");
  if (resumeIdx < 0) return undefined;
  const next = argv[resumeIdx + 1];
  if (next && !next.startsWith("-")) {
    return { sessionId: next };
  }
  return "picker";
}

function stripResumeArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--resume" || a === "-r") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

async function ensureHomeMigrated(): Promise<boolean> {
  const migrated = await migrateHomeIfNeeded();
  if (migrated) {
    invalidateConfigCache();
  }
  return migrated;
}

// ─── --list-sessions ─────────────────────────────────────────────────────────
if (args.includes("--list-sessions")) {
  const migrated = await ensureHomeMigrated();
  if (migrated) {
    console.log("Migrated data to ~/.impulse");
  }
  const projectScope = parseProjectScopeArg(args);
  const summary = await summarizeSessions(projectScope);
  const scopeLabel =
    projectScope === "all" ? "all projects" : "current project";
  console.log(`\nSessions (${scopeLabel}):\n`);
  console.log(`  Total on disk:              ${summary.total}`);
  console.log(`  With user messages:         ${summary.resumeable}  (shown in /resume)`);
  console.log(`  Empty:                      ${summary.empty}  (hidden in /resume)`);
  console.log(`  With header title:          ${summary.withHeaderTitle}`);
  console.log(`  Resumeable, no title yet:   ${summary.resumeableUntitled}\n`);
  process.exit(0);
}

// ─── --enrich-session-titles ─────────────────────────────────────────────────
if (args.includes("--enrich-session-titles")) {
  const migrated = await ensureHomeMigrated();
  if (migrated) {
    console.log("Migrated data to ~/.impulse");
  }
  const enrichOpts = parseEnrichSessionTitlesArgs(args);
  const config = await loadConfig();
  const modelLabel = config.defaultModel ?? "unknown";
  console.log(
    `\nEnriching session titles (${enrichOpts.projectScope === "all" ? "all projects" : "current project"}, model: ${modelLabel})…\n`
  );
  try {
    const result = await enrichSessionTitles({
      ...enrichOpts,
      onProgress: (done, total, sessionId, title) => {
        const shortId = sessionId.length > 20 ? `${sessionId.slice(0, 17)}…` : sessionId;
        if (title) {
          console.log(`  [${done}/${total}] ${shortId} → ${title}`);
        } else if (enrichOpts.dryRun) {
          console.log(`  [${done}/${total}] ${shortId} (dry-run)`);
        } else {
          console.log(`  [${done}/${total}] ${shortId} (no title)`);
        }
      },
    });
    const breakdown = await summarizeSessions(enrichOpts.projectScope);
    console.log(
      `\nDone: ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed (${result.scanned} scanned, ${result.eligible} eligible)${result.dryRun ? " [dry-run]" : ""}`
    );
    console.log(
      `Breakdown: ${breakdown.total} total, ${breakdown.resumeable} with messages, ${breakdown.empty} empty, ${breakdown.withHeaderTitle} titled, ${breakdown.resumeableUntitled} resumeable without title\n`
    );
  } catch (e) {
    console.error(`\n${(e as Error).message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ─── --setup ─────────────────────────────────────────────────────────────────
if (args.includes("--setup")) {
  if (await ensureHomeMigrated()) {
    console.log("Migrated data to ~/.impulse");
  }
  await runSetup();
  process.exit(0);
}

// ─── Migrate before config load (interactive startup) ───────────────────────
if (await ensureHomeMigrated()) {
  console.log("\n  Migrated data to ~/.impulse\n");
}

// ─── Check if any provider is configured ────────────────────────────────────
const config = await loadConfig();
const hasProvider = (
  Object.values(config.providers ?? {}).some((p) => p?.apiKey || p?.baseUrl) ||
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

const resumeStartup = parseResumeArg(args);
const messageArgs = stripResumeArgs(args).filter(
  (a) => !a.startsWith("-") && a !== "--setup"
);

// ─── Init tools & start ──────────────────────────────────────────────────────
const renderer = new ImpulseRenderer(
  resumeStartup ? { resume: resumeStartup } : undefined
);
await renderer.start();

if (messageArgs.length > 0 && messageArgs[0]) {
  const initial = messageArgs.join(" ").trim();
  if (initial) {
    await renderer.submitMessage(initial);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// First-run setup
// ─────────────────────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));

  console.log(`
  \x1b[1mImpulse Setup\x1b[0m
  \x1b[90m-----------------------------------------\x1b[0m
  Choose a provider:

    1. Ollama Cloud   \x1b[90m(https://ollama.com)\x1b[0m
    2. OpenRouter     \x1b[90m(https://openrouter.ai)\x1b[0m
    3. Custom (OpenAI-compatible)   \x1b[90m(any OpenAI-compatible endpoint)\x1b[0m
    4. Custom (Anthropic-compatible) \x1b[90m(any Anthropic-compatible endpoint)\x1b[0m
`);

  const choice = await ask("  Provider [1-4]: ");

  let providerKey = "";
  let envVar: string;
  let label: string;
  let defaultModel: string;
  let needsBaseUrl = false;
  let isCustom = false;
  let customType: "openai-compatible" | "anthropic-compatible" | undefined;

  switch (choice) {
    case "2":
      providerKey = "openrouter";
      envVar = "OPENROUTER_API_KEY";
      label = "OpenRouter";
      defaultModel = "openrouter/anthropic/claude-haiku-4.5";
      break;
    case "3":
      isCustom = true;
      customType = "openai-compatible";
      envVar = "";
      label = "Custom (OpenAI)";
      needsBaseUrl = true;
      defaultModel = "";
      break;
    case "4":
      isCustom = true;
      customType = "anthropic-compatible";
      envVar = "";
      label = "Custom (Anthropic)";
      needsBaseUrl = true;
      defaultModel = "";
      break;
    default:
      providerKey = "ollama";
      envVar = "OLLAMA_API_KEY";
      label = "Ollama Cloud";
      defaultModel = "ollama/llama3.2";
      needsBaseUrl = true;
      break;
  }

  if (isCustom) {
    const name = await ask("  Provider name (slug, e.g. my-llm): ");
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      console.log("  Invalid or empty name — aborting.");
      rl.close();
      return;
    }
    providerKey = name;
  }

  let baseUrl: string | undefined;
  if (needsBaseUrl) {
    const defaultUrl = customType === "anthropic-compatible" ? "https://api.anthropic.com/v1" : "https://ollama.com";
    const prompt = isCustom ? `  Endpoint URL [${defaultUrl}]: ` : `  Endpoint URL [https://ollama.com]: `;
    const entered = await ask(prompt);
    baseUrl = entered || defaultUrl;
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
  } else if (isCustom) {
    // Try model discovery for custom providers
    process.stdout.write("  Discovering models…");
    const customProv: Parameters<typeof discoverModels>[0] = {
      key: providerKey,
      label,
      envVar: "",
      defaultModel: "",
      modelBaseUrl: baseUrl ?? "",
      ...(baseUrl ? { defaultBaseUrl: baseUrl } : {}),
      needsBaseUrl: true,
      isCustom: true,
      ...(customType ? { customType } : {}),
    };
    const discovery = await discoverModels(customProv, key, baseUrl);
    if (discovery.success && discovery.models.length > 0) {
        console.log(` \x1b[32m✓\x1b[0m  ${discovery.message}`);
        console.log(`\n  Available models:`);
        discovery.models.forEach((m, i) => console.log(`    ${i + 1}. ${m}`));
        
        const modelChoice = await ask(`\n  Pick a model (number or full name) [1]: `);
        const idx = parseInt(modelChoice) - 1;
        if (!isNaN(idx) && discovery.models[idx]) {
          defaultModel = `${providerKey}/${discovery.models[idx]}`;
        } else if (modelChoice && !modelChoice.match(/^\d+$/)) {
          defaultModel = modelChoice.includes("/") ? modelChoice : `${providerKey}/${modelChoice}`;
        }
      } else {
        console.log(` \x1b[33m⚠\x1b[0m  ${discovery.message}`);
        const manual = await ask("  Enter model ID manually: ");
        if (manual) {
          defaultModel = manual.includes("/") ? manual : `${providerKey}/${manual}`;
        }
      }
    if (!defaultModel) {
      defaultModel = `${providerKey}/default`;
    }
  }

  // Probe reasoning support for custom providers
  if (isCustom && customType && baseUrl) {
    const modelName = defaultModel.includes("/") ? defaultModel.split("/").slice(1).join("/") : defaultModel;
    process.stdout.write("  Probing reasoning support…");
    const { probeReasoningSupport } = await import("./api/providers/capabilities.js");
    const cap = await probeReasoningSupport(customType, baseUrl, key, modelName);
    if (cap.supported) {
      console.log(` \x1b[32m✓\x1b[0m supported`);
    } else {
      console.log(` \x1b[33m⚠\x1b[0m not supported — reasoning disabled`);
    }
  }

  // Save config
  const cfg = await loadConfig().catch(() => ({
    providers: {} as Record<string, unknown>,
    defaultProvider: providerKey,
    defaultModel,
    defaultMode: "AGENT",
    thinking: true,
    maxOutputTokens: 32000,
    hasSeenWelcome: true,
  }));

  const providers = cfg.providers as Record<string, unknown>;
  providers[providerKey] = {
    apiKey: key,
    ...(baseUrl ? { baseUrl } : {}),
    ...(customType ? { type: customType } : {}),
  };
  cfg.defaultProvider = providerKey;
  cfg.defaultModel = defaultModel;
  if (envVar) process.env[envVar] = key;

  await saveConfig(cfg as Parameters<typeof saveConfig>[0]);
  resetProviderManager();

  // Save to ~/.impulse/.env
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const impulseDir = path.join(homeDir, ".impulse");
  if (!fs.existsSync(impulseDir)) fs.mkdirSync(impulseDir, { recursive: true });
  const envLines = [...(envVar ? [`${envVar}=${key}`] : []), ...(baseUrl && providerKey === "ollama" ? [`OLLAMA_BASE_URL=${baseUrl}`] : [])];
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
  \x1b[90m-----------------------------------------\x1b[0m
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
    defaultMode: "AGENT",
    thinking: true,
    maxOutputTokens: 32000,
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
