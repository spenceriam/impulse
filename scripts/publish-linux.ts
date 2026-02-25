#!/usr/bin/env bun
/**
 * Build and publish linux-x64 binary manually
 * Use this for testing while CI/CD is being set up
 */

import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const VERSION = JSON.parse(readFileSync("package.json", "utf-8")).version;

async function main() {
  console.log(`Building and publishing IMPULSE v${VERSION} for linux-x64...\n`);
  
  // Build dist first
  console.log("Step 1: Building dist/index.js...");
  await $`bun run scripts/build.ts`;
  
  // Build linux-x64 binary
  console.log("\nStep 2: Compiling linux-x64 binary...");
  const outDir = "packages/linux-x64";
  const binDir = join(outDir, "bin");
  
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }
  
  await $`bun build --compile --minify --target=bun-linux-x64 ./dist/index.js --outfile ${join(binDir, "impulse")}`;
  
  // Create package.json for linux-x64
  console.log("\nStep 3: Creating platform package.json...");
  const platformPkg = {
    name: "@spenceriam/impulse-linux-x64",
    version: VERSION,
    description: "IMPULSE binary for linux-x64",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/spenceriam/impulse.git"
    },
    os: ["linux"],
    cpu: ["x64"],
    files: ["bin/*"],
    publishConfig: {
      access: "public"
    }
  };
  writeFileSync(join(outDir, "package.json"), JSON.stringify(platformPkg, null, 2));
  
  // Update CLI wrapper package version
  console.log("\nStep 4: Updating CLI wrapper package...");
  const cliPkg = JSON.parse(readFileSync("packages/cli/package.json", "utf-8"));
  cliPkg.version = VERSION;
  cliPkg.optionalDependencies = {
    "@spenceriam/impulse-linux-x64": VERSION,
    "@spenceriam/impulse-linux-arm64": VERSION,
    "@spenceriam/impulse-darwin-x64": VERSION,
    "@spenceriam/impulse-darwin-arm64": VERSION,
    "@spenceriam/impulse-windows-x64": VERSION,
    "@spenceriam/impulse-windows-arm64": VERSION
  };
  writeFileSync("packages/cli/package.json", JSON.stringify(cliPkg, null, 2));
  
  console.log("\n" + "=".repeat(50));
  console.log("Build complete! Now publish manually:\n");
  console.log("  cd packages/linux-x64 && npm publish --access public");
  console.log("  cd packages/cli && npm publish --access public");
  console.log("\nOr wait for CI/CD to handle all platforms.");
}

main();
