#!/usr/bin/env node

import packageJson from "../package.json";

// =============================================================================
// CLI Argument Parsing - BEFORE any TUI initialization
// =============================================================================

const args = process.argv.slice(2);

// Helper to check for flag
const hasFlag = (short: string, long: string): boolean => {
  return args.includes(short) || args.includes(long);
};

// --help, -h: Print help and exit (no API key needed, no TUI)
if (hasFlag("-h", "--help")) {
  console.log(`
IMPULSE v${packageJson.version} - Terminal-based AI coding agent powered by Z.ai

USAGE:
    impulse [OPTIONS]

OPTIONS:
    -h, --help              Print help and exit
    -v, --version           Print version and exit
    -e, --express           Enable express mode (auto-approve all actions)

ENVIRONMENT:
    GLM_API_KEY             API key for Z.ai (or configure interactively on first run)
                            Will be saved to ~/.config/impulse/config.json

EXAMPLES:
    impulse                 Start interactive TUI
    impulse -e              Start with express mode enabled

For more information, visit: https://github.com/spenceriam/impulse
`);
  process.exit(0);
}

// --version, -v: Print version and exit (no API key needed, no TUI)
if (hasFlag("-v", "--version")) {
  console.log(`IMPULSE v${packageJson.version}`);
  process.exit(0);
}

// =============================================================================
// TTY Detection - Must have interactive terminal for TUI
// =============================================================================

const isTTY = process.stdin.isTTY && process.stdout.isTTY;

if (!isTTY) {
  console.error(`
IMPULSE requires an interactive terminal (TTY).

If you're piping input or running in a non-interactive environment,
make sure to run IMPULSE directly in a terminal.

Alternatively, set your API key via environment variable:
    export GLM_API_KEY=your-key-here

For help:
    impulse --help
`);
  process.exit(1);
}

// =============================================================================
// First-Run Detection - Print banner before TUI if no API key
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

// Main startup
const main = async () => {
  const hasApiKey = await checkApiKey();
  
  // If no API key, print a plain-text banner BEFORE entering TUI
  // This ensures the user knows what's happening even if the TUI prompt isn't obvious
  if (!hasApiKey) {
    console.log(`
IMPULSE v${packageJson.version}

No API key configured.
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

  // Parse remaining CLI arguments for TUI
  const expressMode = hasFlag("-e", "--express");

  render(() => <App initialExpress={expressMode} />);
};

main().catch((error) => {
  console.error("Failed to start IMPULSE:", error.message);
  process.exit(1);
});
