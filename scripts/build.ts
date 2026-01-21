import solidTransformPlugin from "@opentui/solid/bun-plugin";
import { cpSync, readdirSync } from "fs";
import { join } from "path";

// Copy tool description files to dist
const toolsDir = "./src/tools";
const distDir = "./dist";
const txtFiles = readdirSync(toolsDir).filter(f => f.endsWith(".txt"));
for (const file of txtFiles) {
  cpSync(join(toolsDir, file), join(distDir, file));
}

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  target: "node",
  plugins: [solidTransformPlugin],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Build successful!");
for (const output of result.outputs) {
  console.log(`  ${output.path}`);
}
