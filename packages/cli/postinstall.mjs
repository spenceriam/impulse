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
      `IMPULSE currently supports: ${supportedCombos.join(", ")}\n` +
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
    throw new Error(`Could not find package ${packageName}: ${error.message}`);
  }
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin");
  const targetPath = path.join(binDir, binaryName);

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  return { binDir, targetPath };
}

function symlinkBinary(sourcePath, targetPath) {
  // Ensure source binary is executable (npm tarball doesn't preserve execute bit)
  try {
    fs.chmodSync(sourcePath, 0o755);
  } catch (e) {
    // Ignore chmod errors (may not have permission)
  }
  
  fs.symlinkSync(sourcePath, targetPath);
  console.log(`IMPULSE binary symlinked: ${targetPath} -> ${sourcePath}`);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`);
  }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      console.log("Windows detected: using packaged executable");
      return;
    }

    const { binaryPath, binaryName } = findBinary();
    const { targetPath } = prepareBinDirectory(binaryName);
    
    // Create symlink to the platform-specific binary
    symlinkBinary(binaryPath, targetPath);
    
    console.log(`IMPULSE installed successfully!`);
  } catch (error) {
    console.error("Failed to setup IMPULSE binary:", error.message);
    console.error("You may need to install Bun and run IMPULSE directly:");
    console.error("  curl -fsSL https://bun.sh/install | bash");
    console.error("  bun x @spenceriam/impulse");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Postinstall script error:", error.message);
  process.exit(0);
});
