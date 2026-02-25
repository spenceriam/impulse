#!/usr/bin/env node

import packageJson from "../package.json";
import { registerCrashRecoveryHandlers } from "./util/crash-recovery";
import { normalizeMode, type Mode } from "./constants";

// =============================================================================
// CLI Argument Parsing - BEFORE any TUI initialization
// =============================================================================

const args = process.argv.slice(2);
registerCrashRecoveryHandlers();

// Helper to check for flag
const hasFlag = (short: string, long: string): boolean => {
  return args.includes(short) || args.includes(long);
};

// Helper to get flag value (for flags that take arguments)
const getFlagValue = (short: string, long: string): string | null => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === short || arg === long) {
      return args[i + 1] ?? null;
    }
    // Handle --flag=value format
    if (arg?.startsWith(`${long}=`)) {
      return arg.slice(long.length + 1);
    }
  }
  return null;
};

// --help, -h: Print help and exit (no API key needed, no TUI)
if (hasFlag("-h", "--help")) {
  console.log(`
IMPULSE v${packageJson.version} - Terminal-based AI coding agent powered by Z.ai

USAGE:
    impulse [OPTIONS]
    impulse -p "prompt"     Run prompt in headless mode (no TUI)

OPTIONS:
    -h, --help              Print help and exit
    -v, --version           Print version and exit
    -cl, --changelog        Fetch and display changelog from repository
    -e, --express           Enable express mode (auto-approve all actions)

    -p, --prompt <text>     Run prompt in headless mode, output to stdout, exit
    -c, --continue          Show session picker to resume a previous session
    -s, --session <id>      Resume specific session by ID
    
    -m, --model <name>      Override default model (e.g., glm-4.7-flash)
        --mode <mode>       Start in specific mode (work/explore/plan/debug)
    -d, --dir <path>        Set working directory
        --verbose           Enable debug logging to file
        --check-update      Check for updates and exit (debug utility)

ENVIRONMENT:
    GLM_API_KEY             Z.ai Coding Plan API key (not standard Z.ai API)
                            Get your key at: https://z.ai/manage-apikey/subscription
                            Will be saved to ~/.config/impulse/config.json

EXAMPLES:
    impulse                 Start interactive TUI
    impulse -e              Start with express mode enabled
    impulse -p "explain this file" < file.ts
                            Run headless prompt with piped input
    impulse -c              Show session picker to continue a session
    impulse -s sess_123     Resume session with ID sess_123
    impulse --mode work     Start in WORK mode
    impulse -d ~/projects/myapp
                            Start in different directory

For more information, visit: https://github.com/spenceriam/impulse
`);
  process.exit(0);
}

// --version, -v: Print version and exit (no API key needed, no TUI)
if (hasFlag("-v", "--version")) {
  console.log(packageJson.version);
  process.exit(0);
}

// --check-update: Run update check with debug output and exit
if (hasFlag("", "--check-update")) {
  import("./util/update-check").then(async ({ checkForUpdate, getCurrentVersion }) => {
    console.log(`Current version: ${getCurrentVersion()}`);
    console.log("Checking for updates...");
    
    const update = await checkForUpdate();
    
    if (update) {
      console.log(`\nUpdate available!`);
      console.log(`  Latest version: ${update.latestVersion}`);
      console.log(`  Update command: ${update.updateCommand}`);
    } else {
      console.log("\nNo update available (or check failed)");
      console.log("You are on the latest version.");
    }
    
    process.exit(0);
  });
  // Prevent further execution while async import runs
  await new Promise(() => {});
}

// --changelog, -cl: Fetch and display changelog from repo (last 10 versions)
if (hasFlag("-cl", "--changelog")) {
  import("./util/changelog").then(async ({ fetchChangelog, parseChangelog }) => {
    console.log(`IMPULSE v${packageJson.version} - Changelog (last 10 releases)\n`);
    console.log("Fetching changelog from repository...\n");
    
    try {
      const markdown = await fetchChangelog();
      const entries = parseChangelog(markdown).slice(0, 10);
      
      for (const entry of entries) {
        // Version header with type
        const typeLabel = entry.type.toUpperCase();
        console.log(`v${entry.version} - ${entry.date} [${typeLabel}]`);
        
        // Title if present
        if (entry.title) {
          console.log(`  ${entry.title}`);
        }
        
        // Changes
        for (const change of entry.changes) {
          console.log(`  - ${change}`);
        }
        
        console.log(); // Empty line between entries
      }
      
      console.log("View full changelog: https://github.com/spenceriam/impulse/blob/main/CHANGELOG.md");
    } catch (error) {
      console.error(`Failed to fetch changelog: ${(error as Error).message}`);
      console.error("\nYou can view the changelog directly at:");
      console.error("https://github.com/spenceriam/impulse/blob/main/CHANGELOG.md");
      process.exit(1);
    }
    
    process.exit(0);
  });
  // Prevent further execution while async import runs
  await new Promise(() => {});
}

// =============================================================================
// Parse CLI Options (before TTY check, as headless mode doesn't need TTY)
// =============================================================================

const promptText = getFlagValue("-p", "--prompt");
const sessionId = getFlagValue("-s", "--session");
const modelOverride = getFlagValue("-m", "--model");
const modeOverride = getFlagValue("", "--mode");
const dirOverride = getFlagValue("-d", "--dir");
const showContinue = hasFlag("-c", "--continue");
const expressMode = hasFlag("-e", "--express");
const verboseMode = hasFlag("", "--verbose");

// =============================================================================
// Validate for Unknown Flags
// =============================================================================

const knownFlags = new Set([
  "-h", "--help",
  "-v", "--version",
  "-e", "--express",
  "-p", "--prompt",
  "-c", "--continue",
  "-s", "--session",
  "-m", "--model",
  "--mode",
  "-d", "--dir",
  "--verbose",
  "--check-update",
  "-cl", "--changelog",
]);

// Check for unknown flags (anything starting with - that's not in our known set)
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg.startsWith("-")) {
    // Handle --flag=value format
    const flagName = arg.includes("=") ? arg.split("=")[0]! : arg;
    if (!knownFlags.has(flagName)) {
      console.error(`Unknown option: ${arg}`);
      console.error(`Run 'impulse --help' for usage information.`);
      process.exit(1);
    }
    // Skip the next arg if this flag takes a value
    const flagsWithValues = ["-p", "--prompt", "-s", "--session", "-m", "--model", "--mode", "-d", "--dir"];
    if (flagsWithValues.includes(flagName) && !arg.includes("=")) {
      i++; // Skip the value argument
    }
  }
}

// =============================================================================
// Working Directory Override - Apply early
// =============================================================================

if (dirOverride) {
  try {
    process.chdir(dirOverride);
  } catch (error) {
    console.error(`Failed to change directory to '${dirOverride}':`, (error as Error).message);
    process.exit(1);
  }
}

// =============================================================================
// Headless Mode - No TUI needed
// =============================================================================

import { load as loadConfig } from "./util/config";

const envApiKey = process.env["GLM_API_KEY"];

// Check if we have an API key configured
const checkApiKey = async (): Promise<boolean> => {
  if (envApiKey) return true;
  
  try {
    const cfg = await loadConfig();
    return !!cfg.apiKey;
  } catch {
    return false;
  }
};

// Headless execution - run prompt, output response, exit
const runHeadless = async (prompt: string) => {
  const hasApiKey = await checkApiKey();
  if (!hasApiKey) {
    console.error("Error: No API key configured.");
    console.error("Set GLM_API_KEY environment variable or run 'impulse' interactively to configure.");
    process.exit(1);
  }

  const { GLMClient } = await import("./api/client");
  const { StreamProcessor } = await import("./api/stream");
  const { generateSystemPrompt } = await import("./agent/prompts");
  type StreamEvent = import("./api/stream").StreamEvent;
  const cfg = await loadConfig();

  // Use mode override or configured default, then normalize legacy values.
  const mode: Mode = normalizeMode(modeOverride?.toUpperCase() ?? cfg.defaultMode ?? "WORK");
  const model = modelOverride ?? cfg.defaultModel ?? "glm-4.7";

  const messages = [
    { role: "system" as const, content: generateSystemPrompt(mode) },
    { role: "user" as const, content: prompt },
  ];

  const processor = new StreamProcessor();
  
  // Stream content directly to stdout
  processor.onEvent((event: StreamEvent) => {
    if (event.type === "content") {
      process.stdout.write(event.delta);
    } else if (event.type === "reasoning" && verboseMode) {
      // In verbose mode, show thinking to stderr
      process.stderr.write(`[thinking] ${event.delta}`);
    } else if (event.type === "done") {
      // Ensure output ends with newline
      process.stdout.write("\n");
    }
  });

  try {
    const stream = GLMClient.stream({
      messages,
      model: model as any,
      signal: processor.getAbortSignal(),
    });

    await processor.process(stream);
    process.exit(0);
  } catch (error) {
    console.error(`\nError: ${(error as Error).message}`);
    process.exit(1);
  }
};

// If --prompt flag is provided, run in headless mode
if (promptText) {
  runHeadless(promptText);
} else {
  // =============================================================================
  // TTY Detection - Must have interactive terminal for TUI
  // =============================================================================

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;

  if (!isTTY) {
    console.error(`
IMPULSE requires an interactive terminal (TTY).

If you're piping input or running in a non-interactive environment,
use headless mode instead:
    impulse -p "your prompt here"

Alternatively, set your API key via environment variable:
    export GLM_API_KEY=your-key-here

For help:
    impulse --help
`);
    process.exit(1);
  }

  // =============================================================================
  // TUI Mode - Interactive terminal
  // =============================================================================

  const main = async () => {
    const hasApiKey = await checkApiKey();
    
    // If no API key, print a plain-text banner BEFORE entering TUI
    // This ensures the user knows what's happening even if the TUI prompt isn't obvious
    if (!hasApiKey) {
      console.log(`
IMPULSE v${packageJson.version}

No API key configured.

IMPULSE uses Z.ai's Coding Plan API (not the standard Z.ai API).
Get your Coding Plan API key at: https://z.ai/manage-apikey/subscription

The application will now start and prompt you to enter your API key.
Your key will be saved to ~/.config/impulse/config.json

You can also set the GLM_API_KEY environment variable to skip this prompt.
`);
    }

    // =============================================================================
    // TUI Initialization - Only after CLI args and TTY checks pass
    // =============================================================================
    
    const { render } = await import("@opentui/solid");
    const { App } = await import("./ui/App");
    
    // Initialize tools (must be imported early to register with Tool registry)
    await import("./tools/init");
    
    // Initialize formatter system (auto-formats files after write/edit)
    const { Format } = await import("./format");
    Format.init();

    // Build initial props from CLI flags - only include defined values (exactOptionalPropertyTypes)
    const initialProps = {
      ...(expressMode ? { initialExpress: true } : {}),
      ...(modelOverride ? { initialModel: modelOverride } : {}),
      ...(modeOverride ? { initialMode: normalizeMode(modeOverride.toUpperCase()) } : {}),
      ...(sessionId ? { initialSessionId: sessionId } : {}),
      ...(showContinue ? { showSessionPicker: true } : {}),
      ...(verboseMode ? { verbose: true } : {}),
    };

    render(() => <App {...initialProps} />);
  };

  main().catch((error) => {
    console.error("Failed to start IMPULSE:", error.message);
    process.exit(1);
  });
}
