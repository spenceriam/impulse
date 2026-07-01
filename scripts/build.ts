import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Copy tool description files to dist
const toolsDir = "./src/tools";
const distDir = "./dist";
const txtFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".txt"));
for (const file of txtFiles) {
  cpSync(join(toolsDir, file), join(distDir, file));
}

// Copy prompt library
if (existsSync("./prompts")) {
  cpSync("./prompts", join(distDir, "prompts"), { recursive: true });
}

// Copy bundled default skills
if (existsSync("./skills/defaults")) {
  cpSync("./skills/defaults", join(distDir, "skills-defaults"), { recursive: true });
}

// Copy tool documentation library
if (existsSync("./docs/tools")) {
  cpSync("./docs/tools", join(distDir, "docs", "tools"), { recursive: true });
}

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Copy ripgrep binary to dist for compiled binary resolution
const { rgPath } = await import("@vscode/ripgrep");
if (existsSync(rgPath)) {
  const destRg = join(distDir, process.platform === "win32" ? "rg.exe" : "rg");
  cpSync(rgPath, destRg);
  console.log(`  Bundled rg: ${destRg}`);
} else {
  console.warn("  Warning: @vscode/ripgrep binary not found at", rgPath);
}

// Add shebang to the output file
const outputPath = join(distDir, "index.js");
const content = readFileSync(outputPath, "utf-8");
if (!content.startsWith("#!/")) {
  writeFileSync(outputPath, `#!/usr/bin/env bun\n${content}`);
}

console.log("Build successful!");
for (const output of result.outputs) {
  console.log(`  ${output.path}`);
}
