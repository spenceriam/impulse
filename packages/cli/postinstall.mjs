#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function detectPlatformAndArch() {
  let platform;
  switch (os.platform()) {
    case "darwin":
      platform = "darwin";
      break;
    case "linux":
      platform = "linux";
      break;
    case "win32":
      platform = "windows";
      break;
    default:
      platform = os.platform();
      break;
  }

  let arch;
  switch (os.arch()) {
    case "x64":
      arch = "x64";
      break;
    case "arm64":
      arch = "arm64";
      break;
    default:
      arch = os.arch();
      break;
  }

  return { platform, arch };
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch();
  const packageName = `@spenceriam/impulse-${platform}-${arch}`;
  const binaryName = platform === "windows" ? "impulse.exe" : "impulse";

  // Check for unsupported platform/arch combinations
  const supportedCombos = [
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
    "windows-x64",
  ];
  
  const combo = `${platform}-${arch}`;
  if (!supportedCombos.includes(combo)) {
    throw new Error(
      `Unsupported platform: ${platform}-${arch}\n` +
      `impulse currently supports: ${supportedCombos.join(", ")}\n` +
      `Windows ARM64 support is pending Bun's cross-compile target.`
    );
  }

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packageJsonPath);
    const binaryPath = path.join(packageDir, "bin", binaryName);

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`);
    }

    return { binaryPath, binaryName };
  } catch (error) {
    const wrapperPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
    );
    throw new Error(
      `Could not find package ${packageName}: ${error.message}\n` +
        `The platform optional dependency may have failed to install (for example npm 404 on a broken publish).\n` +
        `Try: npm cache clean --force && npm i -g @spenceriam/impulse@${wrapperPkg.version}\n` +
        `Or use the macOS/Linux/Windows archives from the GitHub release for v${wrapperPkg.version}.`
    );
  }
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin");
  const targetPath = path.join(binDir, binaryName);

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  return { binDir, targetPath };
}

function symlinkBinary(sourcePath, targetPath) {
  try {
    fs.chmodSync(sourcePath, 0o755);
  } catch (e) {
    // Ignore chmod errors (may not have permission)
  }

  const tempPath = targetPath + ".tmp-" + process.pid;

  fs.symlinkSync(sourcePath, tempPath);

  try {
    fs.renameSync(tempPath, targetPath);
  } catch (renameError) {
    // Clean up temp symlink on failure
    try { fs.unlinkSync(tempPath); } catch (e) {}
    throw renameError;
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`);
  }
}

async function main() {
  if (os.platform() === "win32") {
    console.log("Windows detected: using packaged executable");
    return;
  }

  const { binaryPath, binaryName } = findBinary();
  const { targetPath } = prepareBinDirectory(binaryName);

  symlinkBinary(binaryPath, targetPath);

  console.log(`impulse binary symlinked: ${targetPath} -> ${binaryPath}`);
  console.log(`impulse installed successfully!`);
}

main().catch((error) => {
  console.error("Failed to setup impulse binary:", error.message);
  console.error("You may need to install Bun and run impulse directly:");
  console.error("  curl -fsSL https://bun.sh/install | bash");
  console.error("  bun x @spenceriam/impulse");
  process.exit(1);
});
