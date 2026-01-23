/**
 * Auto-update checker for IMPULSE
 * Checks npm registry for newer versions and notifies via event bus
 */

import * as semver from "semver";
import { Bus, UpdateEvents } from "../bus/index";

// Package info
const PACKAGE_NAME = "@spenceriam/impulse";
const CURRENT_VERSION = "0.15.2"; // Kept in sync with package.json
const REGISTRY_URL = "https://registry.npmjs.org";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

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
 * Run update check and publish event if update available
 * Called once on app startup
 */
export async function runUpdateCheck(): Promise<void> {
  const update = await checkForUpdate();

  if (update) {
    Bus.publish(UpdateEvents.Available, update);
  }
}

/**
 * Get current version
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
