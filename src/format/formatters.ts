/**
 * Formatter definitions - based on OpenCode's formatter system
 * Each formatter defines: name, command, extensions, and detection logic
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";

export interface FormatterInfo {
  name: string;
  command: string[];
  extensions: string[];
  environment?: Record<string, string>;
  enabled(): Promise<boolean>;
}

/**
 * Find a file by walking up the directory tree
 */
async function findUp(filename: string, startDir: string, stopDir?: string): Promise<string[]> {
  const results: string[] = [];
  let currentDir = startDir;
  
  while (currentDir !== stopDir && currentDir !== dirname(currentDir)) {
    const filePath = join(currentDir, filename);
    if (existsSync(filePath)) {
      results.push(filePath);
    }
    currentDir = dirname(currentDir);
  }
  
  return results;
}

/**
 * Check if a command is available in PATH
 */
function which(command: string): boolean {
  return Bun.which(command) !== null;
}

/**
 * Get the working directory
 */
function getWorkDir(): string {
  return process.cwd();
}

// ============================================
// JavaScript/TypeScript Formatters
// ============================================

export const prettier: FormatterInfo = {
  name: "prettier",
  command: ["bunx", "prettier", "--write", "$FILE"],
  environment: { BUN_BE_BUN: "1" },
  extensions: [
    ".js", ".jsx", ".mjs", ".cjs",
    ".ts", ".tsx", ".mts", ".cts",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".vue", ".svelte",
    ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml",
    ".md", ".mdx", ".graphql", ".gql",
  ],
  async enabled() {
    const items = await findUp("package.json", getWorkDir());
    for (const item of items) {
      try {
        const json = JSON.parse(readFileSync(item, "utf-8"));
        if (json.dependencies?.prettier) return true;
        if (json.devDependencies?.prettier) return true;
      } catch {
        continue;
      }
    }
    return false;
  },
};

export const biome: FormatterInfo = {
  name: "biome",
  command: ["bunx", "@biomejs/biome", "check", "--write", "$FILE"],
  environment: { BUN_BE_BUN: "1" },
  extensions: [
    ".js", ".jsx", ".mjs", ".cjs",
    ".ts", ".tsx", ".mts", ".cts",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".vue", ".svelte",
    ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml",
    ".md", ".mdx", ".graphql", ".gql",
  ],
  async enabled() {
    const configs = ["biome.json", "biome.jsonc"];
    for (const config of configs) {
      const found = await findUp(config, getWorkDir());
      if (found.length > 0) return true;
    }
    return false;
  },
};

// ============================================
// Go Formatter
// ============================================

export const gofmt: FormatterInfo = {
  name: "gofmt",
  command: ["gofmt", "-w", "$FILE"],
  extensions: [".go"],
  async enabled() {
    return which("gofmt");
  },
};

// ============================================
// Rust Formatter
// ============================================

export const rustfmt: FormatterInfo = {
  name: "rustfmt",
  command: ["rustfmt", "$FILE"],
  extensions: [".rs"],
  async enabled() {
    return which("rustfmt");
  },
};

// ============================================
// Python Formatters
// ============================================

export const ruff: FormatterInfo = {
  name: "ruff",
  command: ["ruff", "format", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    if (!which("ruff")) return false;
    
    const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"];
    for (const config of configs) {
      const found = await findUp(config, getWorkDir());
      if (found.length > 0) {
        if (config === "pyproject.toml" && found[0]) {
          try {
            const content = readFileSync(found[0], "utf-8");
            if (content.includes("[tool.ruff]")) return true;
          } catch {
            continue;
          }
        } else if (found[0]) {
          return true;
        }
      }
    }
    
    // Check for ruff in dependencies
    const deps = ["requirements.txt", "pyproject.toml", "Pipfile"];
    for (const dep of deps) {
      const found = await findUp(dep, getWorkDir());
      const foundPath = found[0];
      if (foundPath) {
        try {
          const content = readFileSync(foundPath, "utf-8");
          if (content.includes("ruff")) return true;
        } catch {
          continue;
        }
      }
    }
    
    return false;
  },
};

export const uvformat: FormatterInfo = {
  name: "uv",
  command: ["uv", "format", "--", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    // Don't use if ruff is available
    if (await ruff.enabled()) return false;
    
    if (which("uv")) {
      try {
        const proc = Bun.spawn(["uv", "format", "--help"], { 
          stderr: "pipe", 
          stdout: "pipe" 
        });
        const code = await proc.exited;
        return code === 0;
      } catch {
        return false;
      }
    }
    return false;
  },
};

// ============================================
// Ruby Formatters
// ============================================

export const rubocop: FormatterInfo = {
  name: "rubocop",
  command: ["rubocop", "--autocorrect", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    return which("rubocop");
  },
};

export const standardrb: FormatterInfo = {
  name: "standardrb",
  command: ["standardrb", "--fix", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    return which("standardrb");
  },
};

// ============================================
// Elixir Formatter
// ============================================

export const mix: FormatterInfo = {
  name: "mix",
  command: ["mix", "format", "$FILE"],
  extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
  async enabled() {
    return which("mix");
  },
};

// ============================================
// Zig Formatter
// ============================================

export const zig: FormatterInfo = {
  name: "zig",
  command: ["zig", "fmt", "$FILE"],
  extensions: [".zig", ".zon"],
  async enabled() {
    return which("zig");
  },
};

// ============================================
// C/C++ Formatter
// ============================================

export const clangFormat: FormatterInfo = {
  name: "clang-format",
  command: ["clang-format", "-i", "$FILE"],
  extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"],
  async enabled() {
    const items = await findUp(".clang-format", getWorkDir());
    return items.length > 0;
  },
};

// ============================================
// Kotlin Formatter
// ============================================

export const ktlint: FormatterInfo = {
  name: "ktlint",
  command: ["ktlint", "-F", "$FILE"],
  extensions: [".kt", ".kts"],
  async enabled() {
    return which("ktlint");
  },
};

// ============================================
// Dart Formatter
// ============================================

export const dart: FormatterInfo = {
  name: "dart",
  command: ["dart", "format", "$FILE"],
  extensions: [".dart"],
  async enabled() {
    return which("dart");
  },
};

// ============================================
// OCaml Formatter
// ============================================

export const ocamlformat: FormatterInfo = {
  name: "ocamlformat",
  command: ["ocamlformat", "-i", "$FILE"],
  extensions: [".ml", ".mli"],
  async enabled() {
    if (!which("ocamlformat")) return false;
    const items = await findUp(".ocamlformat", getWorkDir());
    return items.length > 0;
  },
};

// ============================================
// Terraform Formatter
// ============================================

export const terraform: FormatterInfo = {
  name: "terraform",
  command: ["terraform", "fmt", "$FILE"],
  extensions: [".tf", ".tfvars"],
  async enabled() {
    return which("terraform");
  },
};

// ============================================
// Gleam Formatter
// ============================================

export const gleam: FormatterInfo = {
  name: "gleam",
  command: ["gleam", "format", "$FILE"],
  extensions: [".gleam"],
  async enabled() {
    return which("gleam");
  },
};

// ============================================
// Shell Formatter
// ============================================

export const shfmt: FormatterInfo = {
  name: "shfmt",
  command: ["shfmt", "-w", "$FILE"],
  extensions: [".sh", ".bash"],
  async enabled() {
    return which("shfmt");
  },
};

// ============================================
// Nix Formatter
// ============================================

export const nixfmt: FormatterInfo = {
  name: "nixfmt",
  command: ["nixfmt", "$FILE"],
  extensions: [".nix"],
  async enabled() {
    return which("nixfmt");
  },
};

// ============================================
// PHP Formatter (Laravel Pint)
// ============================================

export const pint: FormatterInfo = {
  name: "pint",
  command: ["./vendor/bin/pint", "$FILE"],
  extensions: [".php"],
  async enabled() {
    const items = await findUp("composer.json", getWorkDir());
    for (const item of items) {
      try {
        const json = JSON.parse(readFileSync(item, "utf-8"));
        if (json.require?.["laravel/pint"]) return true;
        if (json["require-dev"]?.["laravel/pint"]) return true;
      } catch {
        continue;
      }
    }
    return false;
  },
};

// ============================================
// R Language Formatter (Air)
// ============================================

export const air: FormatterInfo = {
  name: "air",
  command: ["air", "format", "$FILE"],
  extensions: [".R"],
  async enabled() {
    if (!which("air")) return false;
    
    try {
      const proc = Bun.spawn(["air", "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      
      const reader = proc.stdout.getReader();
      const { value } = await reader.read();
      const output = new TextDecoder().decode(value);
      
      // Check for "Air: An R language server and formatter"
      const firstLine = output.split("\n")[0] || "";
      return firstLine.includes("R language") && firstLine.includes("formatter");
    } catch {
      return false;
    }
  },
};

// ============================================
// HTML/ERB Formatter
// ============================================

export const htmlbeautifier: FormatterInfo = {
  name: "htmlbeautifier",
  command: ["htmlbeautifier", "$FILE"],
  extensions: [".erb", ".html.erb"],
  async enabled() {
    return which("htmlbeautifier");
  },
};

// ============================================
// LaTeX Formatter
// ============================================

export const latexindent: FormatterInfo = {
  name: "latexindent",
  command: ["latexindent", "-w", "-s", "$FILE"],
  extensions: [".tex"],
  async enabled() {
    return which("latexindent");
  },
};

// ============================================
// All Formatters
// ============================================

export const ALL_FORMATTERS: FormatterInfo[] = [
  prettier,
  biome,
  gofmt,
  rustfmt,
  ruff,
  uvformat,
  rubocop,
  standardrb,
  mix,
  zig,
  clangFormat,
  ktlint,
  dart,
  ocamlformat,
  terraform,
  gleam,
  shfmt,
  nixfmt,
  pint,
  air,
  htmlbeautifier,
  latexindent,
];
