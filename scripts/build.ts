import solidTransformPlugin from "@opentui/solid/bun-plugin";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Copy tool description files to dist
const toolsDir = "./src/tools";
const distDir = "./dist";
const txtFiles = readdirSync(toolsDir).filter(f => f.endsWith(".txt"));
for (const file of txtFiles) {
  cpSync(join(toolsDir, file), join(distDir, file));
}

// Copy prompt library
if (existsSync("./prompts")) {
  cpSync("./prompts", join(distDir, "prompts"), { recursive: true });
}

// Copy tool documentation library
if (existsSync("./docs/tools")) {
  cpSync("./docs/tools", join(distDir, "docs", "tools"), { recursive: true });
}

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  target: "bun",
  plugins: [solidTransformPlugin],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Add shebang to the output file for bun execution
const outputPath = join(distDir, "index.js");
const content = readFileSync(outputPath, "utf-8");
if (!content.startsWith("#!/")) {
  writeFileSync(outputPath, `#!/usr/bin/env bun\n${content}`);
  console.log("Added shebang to dist/index.js");
}

console.log("Build successful!");
for (const output of result.outputs) {
  console.log(`  ${output.path}`);
}
