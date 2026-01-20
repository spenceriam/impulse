import solidTransformPlugin from "@opentui/solid/bun-plugin";

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
