import fs from "fs";
import path from "path";

export interface ValidationCommand {
  name: string;
  command: string;
  source: string;
}

function readPackageScripts(cwd: string): Record<string, string> {
  const packageJson = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJson)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJson, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function packageManager(cwd: string): "bun" | "npm" {
  if (fs.existsSync(path.join(cwd, "bun.lock")) || fs.existsSync(path.join(cwd, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

export function detectValidationCommands(cwd = process.cwd()): ValidationCommand[] {
  const scripts = readPackageScripts(cwd);
  const pm = packageManager(cwd);
  const prefix = pm === "bun" ? "bun run" : "npm run";
  const preferred = ["typecheck", "test", "build", "lint"];
  const commands: ValidationCommand[] = [];

  for (const name of preferred) {
    if (scripts[name]) {
      commands.push({
        name,
        command: `${prefix} ${name}`,
        source: "package.json",
      });
    }
  }

  return commands;
}
