/**
 * Update checker for impulse.
 * Checks npm registry for newer versions and supports explicit update modes.
 */

import * as semver from "semver";
import { spawn, spawnSync } from "child_process";
import { writeSync } from "fs";
import { Bus, UpdateEvents } from "../bus/index";
import { isDebugEnabled } from "./debug-log";
import packageJson from "../../package.json";

// Package info
const PACKAGE_NAME = "@spenceriam/impulse";
const CURRENT_VERSION = packageJson.version;
const REGISTRY_URL = "https://registry.npmjs.org";

export const INTERNAL_AUTO_UPDATE_ENV = "IMPULSE_INTERNAL_AUTO_UPDATE";
export const UPDATE_PARENT_PID_ENV = "IMPULSE_UPDATE_PARENT_PID";

export interface PerformUpdateOptions {
  /** Relaunch impulse after a successful update. Defaults to false. */
  relaunch?: boolean;
}

/**
 * Debug log helper - writes to stderr when --verbose is enabled.
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
 * Check npm registry for newer version.
 * Non-blocking, fails silently on network errors.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  debugLog("Starting update check", { currentVersion: CURRENT_VERSION, package: PACKAGE_NAME });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    // URL-encode the scoped package name for npm registry.
    const encodedName = PACKAGE_NAME.replace("/", "%2F");
    const url = `${REGISTRY_URL}/${encodedName}/latest`;
    debugLog("Fetching from registry", { url });

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

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

    // Compare versions using semver.
    const isNewer = semver.gt(latestVersion, CURRENT_VERSION);
    debugLog("Version comparison", {
      current: CURRENT_VERSION,
      latest: latestVersion,
      isNewer,
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
    // Silently fail on network errors - don't block the app.
    debugLog("Update check failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Run update check and notify if update available.
 * Called once on app startup.
 * Does NOT auto-install - just notifies via Bus event.
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
    command: update.updateCommand,
  });

  // Notify that update is available - UI will show prompt.
  Bus.publish(UpdateEvents.Available, {
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    updateCommand: update.updateCommand,
  });
}

export function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function impulseCommand(): string {
  return process.platform === "win32" ? "impulse.cmd" : "impulse";
}

function useShellForCommandShims(): boolean {
  return process.platform === "win32";
}

export function isInternalAutoUpdate(argv: string[] = process.argv.slice(2), env = process.env): boolean {
  return argv.includes("--auto-update") && env[INTERNAL_AUTO_UPDATE_ENV] === "1";
}

export function relaunchImpulse(): void {
  const env = { ...process.env };
  delete env[INTERNAL_AUTO_UPDATE_ENV];
  const child = spawn(impulseCommand(), [], {
    detached: true,
    stdio: "ignore",
    shell: useShellForCommandShims(),
    env,
  });
  child.unref();
}

export function formatUpdateSuccessLines(latestVersion: string, installedVersion: string | undefined, relaunch: boolean): string[] {
  const lines: string[] = [];
  if (installedVersion === latestVersion) {
    lines.push(`  Update successful! impulse is now v${latestVersion}`);
  } else if (installedVersion) {
    lines.push(`  Update completed. Installed version: v${installedVersion}`);
    lines.push(`  (Expected v${latestVersion} - you may need to restart your shell)`);
  } else {
    lines.push(`  Update completed! impulse should now be v${latestVersion}`);
  }
  if (relaunch) {
    lines.push("  Relaunching impulse...");
  } else {
    lines.push("  Run `impulse` to start.");
  }
  return lines;
}

/**
 * Perform the actual update after the app has exited.
 * Runs npm install -g synchronously and prints result to terminal.
 */
export function performUpdate(latestVersion: string, options: PerformUpdateOptions = {}): number {
  const relaunch = options.relaunch === true;

  // Helper function that writes directly to file descriptor 1 (stdout).
  // This bypasses any Node.js/Bun buffering or stream interception.
  const rawPrint = (msg: string) => {
    writeSync(1, msg + "\n");
  };

  rawPrint(`\nUpdating impulse to v${latestVersion}...`);
  rawPrint(`Running: npm install -g ${PACKAGE_NAME}\n`);

  const result = spawnSync(npmCommand(), ["install", "-g", PACKAGE_NAME], {
    stdio: "inherit", // Show npm output directly.
    shell: useShellForCommandShims(),
  });

  if (result.status === 0) {
    // Verify the update worked.
    const versionCheck = spawnSync(impulseCommand(), ["--version"], {
      encoding: "utf-8",
      shell: useShellForCommandShims(),
    });

    const installedVersion = versionCheck.stdout?.trim().match(/(\d+\.\d+\.\d+)/)?.[1];

    // Print success message using raw file descriptor write.
    rawPrint("\n--------------------------------------------------------");
    for (const line of formatUpdateSuccessLines(latestVersion, installedVersion, relaunch)) {
      rawPrint(line);
    }
    rawPrint("--------------------------------------------------------\n");

    if (relaunch) {
      relaunchImpulse();
    }
    return 0;
  } else {
    rawPrint("\n--------------------------------------------------------");
    rawPrint(`  Update failed (exit code ${result.status ?? "unknown"})`);
    rawPrint(`  Try running manually: npm install -g ${PACKAGE_NAME}`);
    rawPrint("--------------------------------------------------------\n");
    return result.status ?? 1;
  }
}

/**
 * Get current version.
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
