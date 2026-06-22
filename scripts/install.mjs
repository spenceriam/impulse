#!/usr/bin/env node
/**
 * Fallback global installer for impulse.
 *
 * Primary install remains:
 *   npm i -g @spenceriam/impulse
 *
 * This script exists for users who need a one-file fallback path. It keeps the
 * logic intentionally small and delegates the actual package install to npm.
 */

import { spawnSync } from "node:child_process";
import os from "node:os";

const SUPPORTED = new Set([
  "linux:x64",
  "linux:arm64",
  "darwin:x64",
  "darwin:arm64",
  "win32:x64",
  "win32:arm64",
]);

const combo = `${os.platform()}:${os.arch()}`;
if (!SUPPORTED.has(combo)) {
  console.error(`Unsupported platform: ${combo}`);
  console.error("Supported: linux/darwin/win32 on x64/arm64");
  process.exit(1);
}

const npmCmd = os.platform() === "win32" ? "npm.cmd" : "npm";
const args = ["i", "-g", "@spenceriam/impulse@latest"];

console.log(`Installing impulse for ${combo} via npm...`);
console.log(`${npmCmd} ${args.join(" ")}`);

const result = spawnSync(npmCmd, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
