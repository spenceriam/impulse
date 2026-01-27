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
import { writeSync } from "fs";
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
  // Helper function that writes directly to file descriptor 1 (stdout)
  // This bypasses any Node.js/Bun buffering or stream interception
  const rawPrint = (msg: string) => {
    writeSync(1, msg + "\n");
  };
  
  rawPrint(`\nUpdating IMPULSE to v${latestVersion}...`);
  rawPrint(`Running: npm install -g ${PACKAGE_NAME}\n`);

  const result = spawnSync("npm", ["install", "-g", PACKAGE_NAME], {
    stdio: "inherit", // Show npm output directly
    shell: true,
  });

  // After stdio: "inherit" returns, the terminal should be back to normal
  // Use a no-op spawnSync to give the terminal time to settle
  spawnSync("true", [], { shell: true });

  if (result.status === 0) {
    // Verify the update worked
    const versionCheck = spawnSync("impulse", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });
    
    const installedVersion = versionCheck.stdout?.trim().match(/(\d+\.\d+\.\d+)/)?.[1];
    
    // Print success message using raw file descriptor write
    rawPrint(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (installedVersion === latestVersion) {
      rawPrint(`  Update successful! IMPULSE is now v${latestVersion}`);
    } else if (installedVersion) {
      rawPrint(`  Update completed. Installed version: v${installedVersion}`);
      rawPrint(`  (Expected v${latestVersion} - you may need to restart your shell)`);
    } else {
      rawPrint(`  Update completed! IMPULSE should now be v${latestVersion}`);
    }
    rawPrint(`  Run 'impulse' to start the new version.`);
    rawPrint(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  } else {
    rawPrint(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    rawPrint(`  Update failed (exit code ${result.status})`);
    rawPrint(`  Try running manually: npm install -g ${PACKAGE_NAME}`);
    rawPrint(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }
}

/**
 * Get current version
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
