import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { CommandRegistry, CommandDefinition } from "./registry";
import { 
  loadInstructions, 
  clearInstructionCacheFor,
} from "../util/instructions";

/**
 * /init Command
 * Creates or updates AGENTS.md based on project state
 */

const InitArgsSchema = z.object({
  force: z.boolean().optional(),
});

// Files/dirs to ignore when scanning project structure
const IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".nyc_output",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  "venv",
  ".venv",
  "env",
  ".env",
  "target",
  ".idea",
  ".vscode",
];



interface ProjectInfo {
  name: string;
  version?: string;
  description?: string;
  license?: string;
  techStack: TechStackItem[];
  structure: string;
  gitStatus: GitStatus | null;
  existingInstructions: ExistingInstructions | null;
}

interface TechStackItem {
  category: string;
  technology: string;
}

interface GitStatus {
  branch: string;
  isRepo: boolean;
  unpushedCount: number;
  stagedFiles: string[];
  modifiedFiles: string[];
  untrackedFiles: string[];
}

interface ExistingInstructions {
  filename: string;
  content: string;
  isAgentsMd: boolean;
}

/**
 * Check if directory is empty (ignoring .git)
 */
async function isDirectoryEmpty(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir);
  const nonGitEntries = entries.filter(e => e !== ".git");
  return nonGitEntries.length === 0;
}

/**
 * Check if file/directory should be ignored
 */
function shouldIgnore(name: string): boolean {
  return IGNORE_PATTERNS.includes(name) || name.startsWith(".");
}

/**
 * Generate directory tree structure
 */
async function generateStructure(dir: string, prefix: string = "", maxDepth: number = 3): Promise<string> {
  if (maxDepth <= 0) return "";

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const filtered = entries.filter(e => !shouldIgnore(e.name));
  
  // Sort: directories first, then files
  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  
  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i]!;
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    
    if (entry.isDirectory()) {
      lines.push(`${prefix}${connector}${entry.name}/`);
      const subTree = await generateStructure(
        path.join(dir, entry.name),
        prefix + childPrefix,
        maxDepth - 1
      );
      if (subTree) lines.push(subTree);
    } else {
      lines.push(`${prefix}${connector}${entry.name}`);
    }
  }

  return lines.join("\n");
}

/**
 * Detect tech stack from package files
 */
async function detectTechStack(dir: string): Promise<TechStackItem[]> {
  const stack: TechStackItem[] = [];

  // Check for package.json (Node.js/JavaScript)
  try {
    const pkgPath = path.join(dir, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    
    stack.push({ category: "Runtime", technology: "Node.js / Bun" });
    
    // Detect language
    if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
      stack.push({ category: "Language", technology: "TypeScript" });
    } else {
      stack.push({ category: "Language", technology: "JavaScript" });
    }
    
    // Detect frameworks
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.react) stack.push({ category: "Framework", technology: "React" });
    if (deps.vue) stack.push({ category: "Framework", technology: "Vue" });
    if (deps.svelte) stack.push({ category: "Framework", technology: "Svelte" });
    if (deps["solid-js"]) stack.push({ category: "Framework", technology: "SolidJS" });
    if (deps.next) stack.push({ category: "Framework", technology: "Next.js" });
    if (deps.express) stack.push({ category: "Framework", technology: "Express" });
    if (deps.fastify) stack.push({ category: "Framework", technology: "Fastify" });
    if (deps["@opentui/core"]) stack.push({ category: "UI", technology: "OpenTUI" });
    
  } catch {
    // No package.json
  }

  // Check for Cargo.toml (Rust)
  try {
    await fs.access(path.join(dir, "Cargo.toml"));
    stack.push({ category: "Language", technology: "Rust" });
  } catch {
    // No Cargo.toml
  }

  // Check for pyproject.toml or requirements.txt (Python)
  try {
    await fs.access(path.join(dir, "pyproject.toml"));
    stack.push({ category: "Language", technology: "Python" });
  } catch {
    try {
      await fs.access(path.join(dir, "requirements.txt"));
      stack.push({ category: "Language", technology: "Python" });
    } catch {
      // No Python files
    }
  }

  // Check for go.mod (Go)
  try {
    await fs.access(path.join(dir, "go.mod"));
    stack.push({ category: "Language", technology: "Go" });
  } catch {
    // No go.mod
  }

  return stack;
}

/**
 * Get git status
 */
async function getGitStatus(dir: string): Promise<GitStatus | null> {
  const { execSync } = await import("child_process");
  
  try {
    // Check if git repo
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "pipe" });
  } catch {
    return null;
  }

  try {
    // Get branch name
    const branch = execSync("git branch --show-current", { cwd: dir, stdio: "pipe" })
      .toString()
      .trim() || "HEAD";

    // Get unpushed commit count
    let unpushedCount = 0;
    try {
      const unpushed = execSync("git rev-list @{u}..HEAD --count 2>/dev/null || echo 0", { 
        cwd: dir, 
        stdio: "pipe",
        shell: "/bin/sh" 
      }).toString().trim();
      unpushedCount = parseInt(unpushed, 10) || 0;
    } catch {
      // No upstream or error
    }

    // Get staged files
    const staged = execSync("git diff --cached --name-only", { cwd: dir, stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);

    // Get modified (unstaged) files
    const modified = execSync("git diff --name-only", { cwd: dir, stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);

    // Get untracked files
    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: dir, stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);

    return {
      branch,
      isRepo: true,
      unpushedCount,
      stagedFiles: staged,
      modifiedFiles: modified,
      untrackedFiles: untracked,
    };
  } catch {
    return {
      branch: "unknown",
      isRepo: true,
      unpushedCount: 0,
      stagedFiles: [],
      modifiedFiles: [],
      untrackedFiles: [],
    };
  }
}

/**
 * Get project name and metadata from package file
 */
async function getProjectMetadata(dir: string): Promise<{ name: string; version?: string; description?: string; license?: string }> {
  // Try package.json first
  try {
    const pkgPath = path.join(dir, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return {
      name: pkg.name || path.basename(dir),
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
    };
  } catch {
    // Fallback to directory name
    return { name: path.basename(dir) };
  }
}

/**
 * Check for existing instruction files
 */
async function checkExistingInstructions(dir: string): Promise<ExistingInstructions | null> {
  const instructions = await loadInstructions(dir);
  
  if (!instructions) return null;

  return {
    filename: instructions.name,
    content: instructions.content,
    isAgentsMd: instructions.name === "AGENTS.md",
  };
}

/**
 * Analyze project and gather all info
 */
async function analyzeProject(dir: string): Promise<ProjectInfo> {
  const metadata = await getProjectMetadata(dir);
  const techStack = await detectTechStack(dir);
  const structure = await generateStructure(dir);
  const gitStatus = await getGitStatus(dir);
  const existingInstructions = await checkExistingInstructions(dir);

  return {
    ...metadata,
    techStack,
    structure,
    gitStatus,
    existingInstructions,
  };
}

/**
 * Generate AGENTS.md content
 */
function generateAgentsMd(info: ProjectInfo, existingContent?: string): string {
  const now = new Date();
  const dateStr = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}`;

  let md = `# AGENTS.md

> Auto-generated by glm-cli on ${dateStr}. This is the project brain.

## Project Overview

**${info.name}**${info.description ? ` - ${info.description}` : ""}

### Identity

- **Name:** ${info.name}
${info.version ? `- **Version:** ${info.version}` : ""}
${info.license ? `- **License:** ${info.license}` : ""}

## Current State

**Status:** Active development

`;

  // Tech stack
  if (info.techStack.length > 0) {
    md += `## Tech Stack

| Category | Technology |
|----------|------------|
`;
    for (const item of info.techStack) {
      md += `| **${item.category}** | ${item.technology} |\n`;
    }
    md += "\n";
  }

  // Project structure
  if (info.structure) {
    md += `## Project Structure

\`\`\`
${info.name}/
${info.structure}
\`\`\`

`;
  }

  // Git status
  if (info.gitStatus) {
    md += `## Git Status

- **Branch:** ${info.gitStatus.branch}
`;
    if (info.gitStatus.unpushedCount > 0) {
      md += `- **Unpushed commits:** ${info.gitStatus.unpushedCount}\n`;
    }
    if (info.gitStatus.stagedFiles.length > 0) {
      md += `- **Staged files:** ${info.gitStatus.stagedFiles.length}\n`;
      for (const file of info.gitStatus.stagedFiles.slice(0, 10)) {
        md += `  - ${file}\n`;
      }
      if (info.gitStatus.stagedFiles.length > 10) {
        md += `  - ... and ${info.gitStatus.stagedFiles.length - 10} more\n`;
      }
    }
    md += "\n";
  }

  // Include context from existing instruction file
  if (existingContent && !info.existingInstructions?.isAgentsMd) {
    md += `## Migrated from ${info.existingInstructions?.filename}

The following content was imported from the existing instruction file:

---

${existingContent}

---

`;
  }

  // Project conventions (placeholder)
  md += `## Project Conventions

### Code Style
- Follow existing patterns in the codebase
- Use consistent naming conventions
- Add comments for complex logic

### Commits
- Use conventional commit format
- Include relevant context in commit messages

## How to Run

\`\`\`bash
# TODO: Add run instructions
\`\`\`

## How to Test

\`\`\`bash
# TODO: Add test instructions
\`\`\`
`;

  return md;
}

/**
 * Handle /init command
 */
async function handleInit(args: Record<string, unknown>): Promise<{ success: boolean; output?: string; error?: string }> {
  const parsed = InitArgsSchema.parse(args);
  const dir = process.cwd();

  // Check if directory is empty
  if (await isDirectoryEmpty(dir)) {
    return {
      success: true,
      output: `Empty project directory detected.

To start a new project:
1. Switch to PLANNER mode (Tab key) to design your project
2. Or switch to PLAN-PRD mode for a quick PRD via Q&A

Once you have files in your project, run /init again to generate AGENTS.md.`,
    };
  }

  // Analyze project
  const info = await analyzeProject(dir);

  // Check if AGENTS.md exists
  const agentsMdPath = path.join(dir, "AGENTS.md");
  let agentsMdExists = false;
  try {
    await fs.access(agentsMdPath);
    agentsMdExists = true;
  } catch {
    // Doesn't exist
  }

  // If AGENTS.md exists and no force flag
  if (agentsMdExists && !parsed.force) {
    // Simple heuristic: if unpushed commits or staged files, suggest update
    const needsUpdate = info.gitStatus && (
      info.gitStatus.unpushedCount > 0 ||
      info.gitStatus.stagedFiles.length > 0
    );

    if (needsUpdate) {
      return {
        success: true,
        output: `AGENTS.md exists but may need updating:
- Unpushed commits: ${info.gitStatus?.unpushedCount || 0}
- Staged files: ${info.gitStatus?.stagedFiles.length || 0}

Run /init --force to regenerate AGENTS.md with current state.`,
      };
    }

    return {
      success: true,
      output: `AGENTS.md already exists and appears up to date.

Run /init --force to regenerate it.`,
    };
  }

  // Generate new AGENTS.md
  let existingContent: string | undefined;
  
  // If there's an existing non-AGENTS.md instruction file, include its content
  if (info.existingInstructions && !info.existingInstructions.isAgentsMd) {
    existingContent = info.existingInstructions.content;
  }

  const agentsMdContent = generateAgentsMd(info, existingContent);

  // Write AGENTS.md
  await fs.writeFile(agentsMdPath, agentsMdContent, "utf-8");

  // Clear instruction cache so next load picks up new file
  clearInstructionCacheFor(dir);

  // Build output message
  let output = `Created AGENTS.md with:
- Project: ${info.name}${info.version ? ` v${info.version}` : ""}
- Tech stack: ${info.techStack.map(t => t.technology).join(", ") || "Not detected"}
- Git branch: ${info.gitStatus?.branch || "N/A"}`;

  if (info.existingInstructions && !info.existingInstructions.isAgentsMd) {
    output += `\n- Migrated content from: ${info.existingInstructions.filename}`;
  }

  if (info.gitStatus?.unpushedCount) {
    output += `\n- Unpushed commits: ${info.gitStatus.unpushedCount}`;
  }

  output += `\n\nReview and customize AGENTS.md as needed.`;

  return {
    success: true,
    output,
  };
}

/**
 * Register /init command
 */
export function registerInitCommand(): void {
  const command: CommandDefinition = {
    name: "init",
    category: "core",
    description: "Create or update AGENTS.md for the project",
    args: InitArgsSchema,
    handler: handleInit,
    examples: [
      "/init",
      "/init --force",
    ],
  };

  CommandRegistry.register(command);
}
