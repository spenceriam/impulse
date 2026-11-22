#!/usr/bin/env node
/**
 * Impulse — CLI co-partner agent entry point
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
import { parseStartupFlags, findUnknownFlag } from "./cli/startup-flags.js";
import { printStartupSplash, waitForTuiStart } from "./cli/startup-splash.js";
import { initPty } from "./pty/index.js";
import { migrateHomeIfNeeded } from "./session/migrate-home.js";
import { enrichSessionTitles } from "./session/enrich-titles.js";
import { summarizeSessions } from "./session/session-content.js";
import { cleanupAllBgJobsSync } from "./tools/bg-process-registry.js";
import packageJson from "../package.json";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

registerCrashRecoveryHandlers();

// Best-effort safety net: reap any still-running background jobs if the
// process exits without going through ImpulseRenderer.gracefulExit() (e.g. a
// crash, or a signal not handled elsewhere).
process.on("exit", () => cleanupAllBgJobsSync());

const args = process.argv.slice(2);

const unknownFlag = findUnknownFlag(args);
if (unknownFlag) {
  console.error(`unknown flag: ${unknownFlag}\nTry 'impulse --help'.`);
  process.exit(1);
}

// ─── --version ───────────────────────────────────────────────────────────────
if (args.includes("--version") || args.includes("-v")) {
  console.log(packageJson.version);
  process.exit(0);
}

// ─── --update ────────────────────────────────────────────────────────────────
if (args.includes("--update") || args.includes("--auto-update")) {
  const {
    checkForUpdate,
    performUpdate,
    getCurrentVersion,
    isInternalAutoUpdate,
    relaunchImpulse,
  } = await import("./util/update-check.js");
  const update = await checkForUpdate();
  if (!update) {
    console.log(`Already on latest (v${getCurrentVersion()}).`);
    if (isInternalAutoUpdate(args)) {
      relaunchImpulse();
    }
    process.exit(0);
  }
  console.log(`Updating ${update.currentVersion} -> ${update.latestVersion}...`);
  const resumeIdx = args.findIndex((a) => a === "--resume" || a === "-r");
  const resumeSessionId = resumeIdx >= 0 ? args[resumeIdx + 1] : undefined;
  process.exit(
    performUpdate(update.latestVersion, {
      relaunch: isInternalAutoUpdate(args),
      ...(resumeSessionId && !resumeSessionId.startsWith("-") ? { resumeSessionId } : {}),
    })
  );
}

// ─── --help ──────────────────────────────────────────────────────────────────
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  impulse v${packageJson.version}
  Provider-flexible CLI co-partner agent.

  Usage:
    impulse                   Start interactive session
    impulse "your message"    Send a single message then enter interactive
    impulse -r, --resume      Resume session (picker)
    impulse --resume <id>     Resume session by id
    impulse --setup                   Configure AI provider
    impulse --enrich-session-titles Backfill AI titles on saved sessions
    impulse --list-sessions           Count sessions (total, empty, titled)
    impulse --version                 Show version
    impulse --update                  Install latest from npm and exit
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
  return {
    projectScope,
    dryRun,
    ...(limit !== undefined ? { limit } : {}),
  };
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

function buildMessageArgs(argv: string[]): string[] {
  const stripped = stripResumeArgs(argv).filter((a) => a !== "--setup");
  const sepIdx = stripped.indexOf("--");
  if (sepIdx >= 0) {
    return stripped.slice(sepIdx + 1);
  }
  return stripped.filter((a) => !a.startsWith("-"));
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

// ─── --list-traces / --trace <id> ────────────────────────────────────────────
if (args.includes("--list-traces") || args.includes("--trace")) {
  const { listTracedSessions, readTraceRecords } = await import("./harness/trace.js");
  const traceIdx = args.indexOf("--trace");
  const sessionID = traceIdx >= 0 ? args[traceIdx + 1] : undefined;
  if (!sessionID) {
    const ids = await listTracedSessions();
    console.log(`\nTraced sessions (${ids.length}):\n`);
    for (const id of ids) console.log(`  ${id}`);
    if (ids.length === 0) console.log("  (no traces yet — they are written per turn)");
    console.log("");
    process.exit(0);
  }
  const records = await readTraceRecords(sessionID);
  if (records.length === 0) {
    console.error(`No trace records for session ${sessionID}.`);
    process.exit(1);
  }
  for (const record of records) {
    const tools = record.steps.tools.map((t) => `${t.name}:${t.outcome}`).join(", ");
    const cached = record.input.cachedTokens ? ` cached:${record.input.cachedTokens}` : "";
    console.log(
      `turn ${record.turn}  ${record.mode}  ${record.model}  prompt:${record.input.promptTokens ?? "?"}${cached}  ${record.outcome}${tools ? `  [${tools}]` : ""}`
    );
  }
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

let resumeStartup = parseResumeArg(args);
let resumeReason: "interrupted" | undefined;
let resumableOffer: { sessionId: string; title?: string } | undefined;
if (!resumeStartup) {
  const { consumeUpdateResumeHint, isUpdateResumeHintValid } = await import(
    "./util/update-resume-hint.js"
  );
  const updateHint = consumeUpdateResumeHint();
  if (updateHint && isUpdateResumeHintValid(updateHint)) {
    resumeStartup = { sessionId: updateHint.sessionId };
  }
}
if (!resumeStartup) {
  // Auto-resume sessions interrupted by dev watch reloads, crashes, or kills (#78)
  // — but only for restarts impulse orchestrated; a plain relaunch starts clean (#140).
  const { resolveInterruptedSessionResume } = await import(
    "./util/active-session-marker.js"
  );
  const interrupted = await resolveInterruptedSessionResume();
  if (interrupted?.resumed) {
    resumeStartup = { sessionId: interrupted.sessionId };
    resumeReason = "interrupted";
  } else if (interrupted) {
    resumableOffer = {
      sessionId: interrupted.sessionId,
      ...(interrupted.title ? { title: interrupted.title } : {}),
    };
  }
}
const { flags: startupFlags } = parseStartupFlags(args);
const messageArgs = buildMessageArgs(args);

// ─── Init tools & start ──────────────────────────────────────────────────────
await printStartupSplash(
  resumeStartup !== undefined ? { resume: resumeStartup } : undefined
);
await waitForTuiStart({ timeoutMs: 3000 });
await initPty();

const renderer = new ImpulseRenderer({
  ...(resumeStartup
    ? { resume: resumeStartup, ...(resumeReason ? { resumeReason } : {}) }
    : {}),
  ...(resumableOffer ? { resumableOffer } : {}),
  allowAllOnStartup: startupFlags.allowAllOnStartup,
});
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

  // Same provider list as the in-app picker (#214): one source of truth, so
  // the CLI and TUI cannot drift apart. Fixed-endpoint providers ask only for
  // a key; custom templates still ask for a name and URL.
  const { MODEL_PROVIDERS } = await import("./cli/model-setup.js");
  console.log(`
  \x1b[1mImpulse Setup\x1b[0m
  \x1b[90m-----------------------------------------\x1b[0m
  Choose a provider:
`);
  MODEL_PROVIDERS.forEach((p, i) => {
    const url = p.modelBaseUrl ? `   \x1b[90m(${p.modelBaseUrl})\x1b[0m` : "";
    console.log(`    ${i + 1}. ${p.label}${url}`);
  });
  console.log("");

  const choice = await ask(`  Provider [1-${MODEL_PROVIDERS.length}]: `);
  const picked = MODEL_PROVIDERS[Number.parseInt(choice, 10) - 1] ?? MODEL_PROVIDERS[0]!;

  let providerKey = picked.key;
  const envVar = picked.envVar;
  const label = picked.label;
  let defaultModel = picked.defaultModel;
  const isCustom = picked.isCustom === true;
  const customType = picked.customType;
  // First-class providers have fixed endpoints (#211): never ask for a URL.
  let needsBaseUrl = isCustom;
  let baseUrl: string | undefined = picked.defaultBaseUrl ?? picked.modelBaseUrl;

  if (isCustom) {
    const name = await ask("  Provider name (slug, e.g. my-llm): ");
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      console.log("  Invalid or empty name — aborting.");
      rl.close();
      return;
    }
    providerKey = name;
  }

  if (needsBaseUrl) {
    const defaultUrl =
      picked.defaultBaseUrl ??
      (customType === "anthropic-compatible" ? "https://api.anthropic.com/v1" : "");
    const entered = await ask(`  Endpoint URL${defaultUrl ? ` [${defaultUrl}]` : ""}: `);
    baseUrl = entered || defaultUrl || undefined;
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
  } else if (!isCustom) {
    // First-class providers discover through the same path the app uses, so
    // modalities, context, and reasoning tiers come from one implementation.
    process.stdout.write("  Discovering models…");
    const discovery = await discoverModels(picked, key, baseUrl);
    if (discovery.success && discovery.models.length > 0) {
      console.log(` \x1b[32m✓\x1b[0m  ${discovery.message}`);
      const shown = discovery.models.slice(0, 10);
      shown.forEach((m, i) => console.log(`    ${i + 1}. ${m}`));
      if (discovery.models.length > shown.length) {
        console.log(`    … and ${discovery.models.length - shown.length} more`);
      }
      const modelChoice = await ask(`\n  Pick a model (number or full name) [1]: `);
      const idx = parseInt(modelChoice, 10) - 1;
      if (!isNaN(idx) && discovery.models[idx]) {
        defaultModel = `${providerKey}/${discovery.models[idx]}`;
      } else if (modelChoice && !modelChoice.match(/^\d+$/)) {
        defaultModel = modelChoice.includes("/") ? modelChoice : `${providerKey}/${modelChoice}`;
      }
    } else {
      console.log(` \x1b[33m⚠\x1b[0m  ${discovery.message}`);
    }
  } else {
    // Custom providers: try model discovery
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
  const cfg = await loadConfig();

  const providers = cfg.providers as Record<string, unknown>;
  providers[providerKey] = {
    apiKey: key,
    ...(baseUrl ? { baseUrl } : {}),
    ...(customType ? { type: customType } : {}),
  };
  cfg.defaultProvider = providerKey;
  cfg.defaultModel = defaultModel;
  cfg.modelExplicitlySet = Boolean(defaultModel?.trim());
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

    1. Balanced   \x1b[90m(practical default; brief reasoning)\x1b[0m
    2. Concise    \x1b[90m(short, direct answers)\x1b[0m
    3. Detailed   \x1b[90m(thorough explanations)\x1b[0m
    4. Casual     \x1b[90m(relaxed, friendly tone)\x1b[0m
    5. Technical  \x1b[90m(precise, code-focused)\x1b[0m
    6. Other      \x1b[90m(describe your preference)\x1b[0m
`);

  const prefChoice = await ask("  Choice [1]: ");
  let responsePreference: string;

  switch (prefChoice) {
    case "2":
      responsePreference = "concise";
      break;
    case "3":
      responsePreference = "detailed";
      break;
    case "4":
      responsePreference = "casual";
      break;
    case "5": {
      responsePreference = "technical";
      break;
    }
    case "6": {
      const custom = await ask("  Describe your preferred style: ");
      responsePreference = custom || "balanced";
      break;
    }
    default:
      responsePreference = "balanced";
  }

  console.log(`
  \x1b[90mCustom instructions are managed inside Impulse with /instructions.
  That workflow supports multiline Markdown and @path imports.\x1b[0m
`);

  // Load config and save user profile
  const cfg = await loadConfig();
  const legacyCustomInstructions = cfg.userProfile?.customInstructions ?? "";

  cfg.userProfile = {
    name,
    responsePreference,
    customInstructions: legacyCustomInstructions,
  };
  cfg.hasSeenWelcome = true;

  await saveConfig(cfg as Parameters<typeof saveConfig>[0]);

  console.log(`\n  \x1b[32m✓\x1b[0m  Welcome, ${name}! Your preferences have been saved.\n`);
  rl.close();
}
