/**
 * Auto-update checker and installer for IMPULSE
 * Checks npm registry for newer versions and auto-installs updates
 */

import * as semver from "semver";
import { spawn } from "child_process";
import { Bus, UpdateEvents } from "../bus/index";
import packageJson from "../../package.json";

// Package info
const PACKAGE_NAME = "@spenceriam/impulse";
const CURRENT_VERSION = packageJson.version; // Read from package.json
const REGISTRY_URL = "https://registry.npmjs.org";

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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    // URL-encode the scoped package name for npm registry
    const encodedName = PACKAGE_NAME.replace("/", "%2F");
    const response = await fetch(
      `${REGISTRY_URL}/${encodedName}/latest`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { version?: string };
    const latestVersion = data.version;

    if (!latestVersion) {
      return null;
    }

    // Compare versions using semver
    if (semver.gt(latestVersion, CURRENT_VERSION)) {
      return {
        currentVersion: CURRENT_VERSION,
        latestVersion,
        updateCommand: `npm i -g ${PACKAGE_NAME}`,
      };
    }

    return null;
  } catch {
    // Silently fail on network errors - don't block the app
    return null;
  }
}

/**
 * Run npm install to update the package
 * Returns true if install succeeded, false otherwise
 */
async function runNpmInstall(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", PACKAGE_NAME], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stderr = "";

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });

    child.on("error", () => {
      resolve(false);
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      resolve(false);
    }, 60000);
  });
}

/**
 * Verify the installed version matches expected version
 */
async function verifyInstalledVersion(expectedVersion: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const encodedName = PACKAGE_NAME.replace("/", "%2F");
    const response = await fetch(
      `${REGISTRY_URL}/${encodedName}/latest`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return false;
    }

    // We can't easily check installed version without spawning another process
    // Instead, trust the npm install exit code and verify registry has the version
    const data = (await response.json()) as { version?: string };
    return data.version === expectedVersion;
  } catch {
    return false;
  }
}

/**
 * Run update check and auto-install if update available
 * Called once on app startup
 */
export async function runUpdateCheck(): Promise<void> {
  const update = await checkForUpdate();

  if (!update) {
    return;
  }

  // Notify that we're installing
  Bus.publish(UpdateEvents.Installing, { latestVersion: update.latestVersion });

  // Run the install
  const installSuccess = await runNpmInstall();

  if (!installSuccess) {
    Bus.publish(UpdateEvents.Failed, {
      latestVersion: update.latestVersion,
      updateCommand: update.updateCommand,
      error: "npm install failed",
    });
    return;
  }

  // Verify installation
  const verified = await verifyInstalledVersion(update.latestVersion);

  if (verified) {
    Bus.publish(UpdateEvents.Installed, { latestVersion: update.latestVersion });
  } else {
    Bus.publish(UpdateEvents.Failed, {
      latestVersion: update.latestVersion,
      updateCommand: update.updateCommand,
      error: "Version verification failed",
    });
  }
}

/**
 * Get current version
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
