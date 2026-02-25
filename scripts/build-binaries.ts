#!/usr/bin/env bun
/**
 * Build platform-specific binaries for IMPULSE
 * Uses Bun's compile feature to create standalone executables
 */

import { $ } from "bun";
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const VERSION = JSON.parse(readFileSync("package.json", "utf-8")).version;

// Platforms to build for
const PLATFORMS = [
  // Linux
  { name: "linux-x64", target: "bun-linux-x64", binary: "impulse", os: "linux" },
  { name: "linux-arm64", target: "bun-linux-arm64", binary: "impulse", os: "linux" },
  // macOS (Intel and Apple Silicon M-series)
  { name: "darwin-x64", target: "bun-darwin-x64", binary: "impulse", os: "darwin" },
  { name: "darwin-arm64", target: "bun-darwin-arm64", binary: "impulse", os: "darwin" },
  // Windows
  { name: "windows-x64", target: "bun-windows-x64", binary: "impulse.exe", os: "win32" },
  { name: "windows-arm64", target: "bun-windows-arm64", binary: "impulse.exe", os: "win32" },
] as const;

async function buildPlatform(platform: typeof PLATFORMS[number]) {
  console.log(`\nBuilding for ${platform.name}...`);
  
  const outDir = `packages/${platform.name}`;
  const binDir = join(outDir, "bin");
  
  // Ensure directories exist
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }
  
  const outFile = join(binDir, platform.binary);
  
  try {
    // Bun compile with cross-compilation target
    // Note: We need to compile from the pre-built dist/index.js since plugins don't work with --compile
    await $`bun build --compile --minify --sourcemap --target=${platform.target} ./dist/index.js --outfile ${outFile}`;
    
    console.log(`  ✓ Built ${outFile}`);
    
    // Create package.json for this platform package
    const packageJson = {
      name: `@spenceriam/impulse-${platform.name}`,
      version: VERSION,
      description: `IMPULSE binary for ${platform.name}`,
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/spenceriam/impulse.git"
      },
      os: [platform.os],
      cpu: [platform.name.split("-")[1]],
      files: ["bin/*"],
      publishConfig: {
        access: "public"
      }
    };
    
    writeFileSync(
      join(outDir, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );
    
    console.log(`  ✓ Created ${outDir}/package.json`);
    
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to build ${platform.name}:`, error);
    return false;
  }
}

async function main() {
  console.log(`Building IMPULSE v${VERSION} binaries...\n`);
  
  // First, ensure we have a fresh build of dist/index.js
  console.log("Building dist/index.js with plugins...");
  await $`bun run scripts/build.ts`;
  
  // Build for each platform
  const results = await Promise.all(PLATFORMS.map(buildPlatform));
  
  const succeeded = results.filter(Boolean).length;
  const failed = results.length - succeeded;
  
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Build complete: ${succeeded} succeeded, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main();
