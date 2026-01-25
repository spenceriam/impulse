/**
 * Auto-update checker and installer for IMPULSE
 * Checks npm registry for newer versions and auto-installs updates
 * 
 * Handles both global (-g) and local installs by detecting where
 * the current binary is running from.
 */

import * as semver from "semver";
import { spawn } from "child_process";
import { Bus, UpdateEvents } from "../bus/index";
import { isDebugEnabled } from "./debug-log";
import packageJson from "../../package.json";

// Package info
const PACKAGE_NAME = "@spenceriam/impulse";
const CURRENT_VERSION = packageJson.version; // Read from package.json
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

/**
 * Detect if running from a global npm install
 * Global installs typically have paths like:
 * - /usr/local/bin/impulse
 * - ~/.nvm/versions/node/vX.X.X/bin/impulse
 * - C:\Users\X\AppData\Roaming\npm\impulse
 * 
 * Local installs would be in node_modules/.bin/ within a project
 */
function isGlobalInstall(): boolean {
  const execPath = process.execPath;
  const argv0 = process.argv[0] || "";
  
  // Check if running from node_modules (local install)
  if (execPath.includes("node_modules") || argv0.includes("node_modules")) {
    return false;
  }
  
  // Check common global paths
  const globalIndicators = [
    "/usr/local/",
    "/usr/bin/",
    "/.nvm/",
    "/AppData/Roaming/npm",
    "\\AppData\\Roaming\\npm",
  ];
  
  return globalIndicators.some(indicator => 
    execPath.includes(indicator) || argv0.includes(indicator)
  );
}

/**
 * Get the appropriate npm install command based on install location
 */
function getInstallCommand(): string {
  if (isGlobalInstall()) {
    return `npm install -g ${PACKAGE_NAME}`;
  } else {
    // Local install - just update in current directory
    return `npm install ${PACKAGE_NAME}`;
  }
}

/**
 * Get npm install args based on install location
 */
function getNpmInstallArgs(): string[] {
  if (isGlobalInstall()) {
    return ["install", "-g", PACKAGE_NAME];
  } else {
    return ["install", PACKAGE_NAME];
  }
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

export type UpdateState = 
  | { status: "checking" }
  | { status: "installing"; latestVersion: string }
  | { status: "installed"; latestVersion: string }
  | { status: "failed"; latestVersion: string; updateCommand: string; error?: string };

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
        updateCommand: getInstallCommand(),
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
 * Run npm install to update the package
 * Uses global or local install based on where current binary is running from
 * Returns { success: boolean, error?: string }
 */
async function runNpmInstall(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = getNpmInstallArgs();
    const child = spawn("npm", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stderr = "";

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        // Check for common permission errors
        const installCmd = getInstallCommand();
        const errorMsg = stderr.includes("EACCES") || stderr.includes("permission")
          ? `Permission denied - try: sudo ${installCmd}`
          : stderr.slice(0, 200) || `Exit code ${code}`;
        resolve({ success: false, error: errorMsg });
      }
    });

    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      resolve({ success: false, error: "Install timed out" });
    }, 60000);
  });
}

/**
 * Verify the installed version matches expected version
 * Spawns `impulse --version` to check what's actually installed
 */
async function verifyInstalledVersion(expectedVersion: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("impulse", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }
      
      // Parse version from output (format: "impulse v0.20.0" or just "0.20.0")
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        resolve(versionMatch[1] === expectedVersion);
      } else {
        resolve(false);
      }
    });

    child.on("error", () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Run update check and auto-install if update available
 * Called once on app startup
 */
export async function runUpdateCheck(): Promise<void> {
  debugLog("runUpdateCheck started");
  const update = await checkForUpdate();

  if (!update) {
    debugLog("No update available or check failed");
    return;
  }

  debugLog("Update available, starting install", { 
    from: update.currentVersion, 
    to: update.latestVersion,
    command: update.updateCommand 
  });

  // Notify that we're installing
  Bus.publish(UpdateEvents.Installing, { latestVersion: update.latestVersion });

  // Run the install
  const installResult = await runNpmInstall();
  debugLog("Install result", installResult);

  if (!installResult.success) {
    debugLog("Install failed", { error: installResult.error });
    Bus.publish(UpdateEvents.Failed, {
      latestVersion: update.latestVersion,
      updateCommand: update.updateCommand,
      error: installResult.error || "npm install failed",
    });
    return;
  }

  // Verify installation by checking what version is actually installed
  debugLog("Verifying installed version");
  const verified = await verifyInstalledVersion(update.latestVersion);
  debugLog("Verification result", { verified, expectedVersion: update.latestVersion });

  if (verified) {
    Bus.publish(UpdateEvents.Installed, { latestVersion: update.latestVersion });
  } else {
    // Install command succeeded but version didn't change
    // This can happen if running from a different location than global npm
    Bus.publish(UpdateEvents.Failed, {
      latestVersion: update.latestVersion,
      updateCommand: update.updateCommand,
      error: "Update installed but version unchanged. You may need to restart your terminal or run: " + update.updateCommand,
    });
  }
}

/**
 * Get current version
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
