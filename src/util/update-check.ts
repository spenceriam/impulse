/**
 * Update checker for IMPULSE
 * Checks npm registry for newer versions and prompts user to update.
 * 
 * NEW APPROACH (v0.27.12):
 * - Check for updates on startup
 * - If update available, show notification with [Y] to update
 * - If user confirms, EXIT the app first (so binary can be replaced)
 * - Run npm install after exit
 * - Show result in terminal and prompt to restart
 */

import * as semver from "semver";
import { spawnSync } from "child_process";
import { Bus, UpdateEvents } from "../bus/index";
import { isDebugEnabled } from "./debug-log";
import packageJson from "../../package.json";

// Package info
const PACKAGE_NAME = "@spenceriam/impulse";
const CURRENT_VERSION = packageJson.version;
const REGISTRY_URL = "https://registry.npmjs.org";

/**
 * Debug log helper - writes to stderr when --verbose is enabled
 */
function debugLog(message: string, data?: unknown): void {
  if (isDebugEnabled()) {
    const timestamp = new Date().toISOString();
    if (data !== undefined) {
      console.error(`[UPDATE ${timestamp}] ${message}`, JSON.stringify(data));
    } else {
      console.error(`[UPDATE ${timestamp}] ${message}`);
    }
  }
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

export type UpdateState = 
  | { status: "checking" }
  | { status: "available"; latestVersion: string; updateCommand: string }
  | { status: "none" };

/**
 * Check npm registry for newer version
 * Non-blocking, fails silently on network errors
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  debugLog("Starting update check", { currentVersion: CURRENT_VERSION, package: PACKAGE_NAME });
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    // URL-encode the scoped package name for npm registry
    const encodedName = PACKAGE_NAME.replace("/", "%2F");
    const url = `${REGISTRY_URL}/${encodedName}/latest`;
    debugLog("Fetching from registry", { url });
    
    const response = await fetch(
      url,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      debugLog("Registry returned error", { status: response.status, statusText: response.statusText });
      return null;
    }

    const data = (await response.json()) as { version?: string };
    const latestVersion = data.version;
    debugLog("Registry response", { latestVersion });

    if (!latestVersion) {
      debugLog("No version in response");
      return null;
    }

    // Compare versions using semver
    const isNewer = semver.gt(latestVersion, CURRENT_VERSION);
    debugLog("Version comparison", { 
      current: CURRENT_VERSION, 
      latest: latestVersion, 
      isNewer 
    });
    
    if (isNewer) {
      return {
        currentVersion: CURRENT_VERSION,
        latestVersion,
        updateCommand: `npm install -g ${PACKAGE_NAME}`,
      };
    }

    return null;
  } catch (error) {
    // Silently fail on network errors - don't block the app
    debugLog("Update check failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Run update check and notify if update available
 * Called once on app startup
 * Does NOT auto-install - just notifies via Bus event
 */
export async function runUpdateCheck(): Promise<void> {
  debugLog("runUpdateCheck started");
  const update = await checkForUpdate();

  if (!update) {
    debugLog("No update available or check failed");
    return;
  }

  debugLog("Update available", { 
    from: update.currentVersion, 
    to: update.latestVersion,
    command: update.updateCommand 
  });

  // Notify that update is available - UI will show prompt
  Bus.publish(UpdateEvents.Available, { 
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    updateCommand: update.updateCommand,
  });
}

/**
 * Perform the actual update after app has exited
 * This is called from index.tsx after renderer.destroy()
 * 
 * Runs npm install -g synchronously and prints result to terminal
 */
export function performUpdate(latestVersion: string): void {
  console.log(`\nUpdating IMPULSE to v${latestVersion}...`);
  console.log(`Running: npm install -g ${PACKAGE_NAME}\n`);

  const result = spawnSync("npm", ["install", "-g", PACKAGE_NAME], {
    stdio: "inherit", // Show npm output directly
    shell: true,
  });

  if (result.status === 0) {
    // Verify the update worked
    const versionCheck = spawnSync("impulse", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });
    
    const installedVersion = versionCheck.stdout?.match(/(\d+\.\d+\.\d+)/)?.[1];
    
    if (installedVersion === latestVersion) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`  Update successful! IMPULSE is now v${latestVersion}`);
      console.log(`  Run 'impulse' to start the new version.`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    } else {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`  Update completed but version mismatch.`);
      console.log(`  Expected: v${latestVersion}`);
      console.log(`  Got: v${installedVersion || "unknown"}`);
      console.log(`  Try running: npm install -g ${PACKAGE_NAME}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }
  } else {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Update failed (exit code ${result.status})`);
    console.log(`  Try running manually: npm install -g ${PACKAGE_NAME}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }
}

/**
 * Get current version
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
