import fs from "fs/promises";
import path from "path";

/**
 * Instruction File Discovery
 * Finds and loads project instruction files in priority order
 */

// Priority order for instruction files (first found wins)
const INSTRUCTION_FILES = [
  ".glm-cli/instructions.md",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "QWEN.md",
  "KIMI.md",
  "COPILOT.md",
  ".cursorrules",
  ".windsurfrules",
] as const;

export type InstructionFileName = typeof INSTRUCTION_FILES[number];

export interface InstructionFile {
  // Full path to the file
  path: string;
  // Filename (from INSTRUCTION_FILES)
  name: InstructionFileName;
  // File content
  content: string;
}

// Cache for loaded instructions (per directory)
const cache = new Map<string, InstructionFile | null>();

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the first instruction file in priority order
 * @param dir - Directory to search in (defaults to cwd)
 * @returns Path to found file, or null if none found
 */
export async function findInstructions(
  dir: string = process.cwd()
): Promise<string | null> {
  const absoluteDir = path.resolve(dir);

  for (const filename of INSTRUCTION_FILES) {
    const filePath = path.join(absoluteDir, filename);
    if (await fileExists(filePath)) {
      return filePath;
    }
  }

  return null;
}

/**
 * Load instruction file from a directory
 * Results are cached per directory for the session
 * @param dir - Directory to search in (defaults to cwd)
 * @returns InstructionFile or null if none found
 */
export async function loadInstructions(
  dir: string = process.cwd()
): Promise<InstructionFile | null> {
  const absoluteDir = path.resolve(dir);

  // Check cache first
  if (cache.has(absoluteDir)) {
    return cache.get(absoluteDir) ?? null;
  }

  // Find and load
  const filePath = await findInstructions(absoluteDir);
  
  if (!filePath) {
    cache.set(absoluteDir, null);
    return null;
  }

  const content = await fs.readFile(filePath, "utf-8");
  const name = path.relative(absoluteDir, filePath) as InstructionFileName;
  
  const result: InstructionFile = {
    path: filePath,
    name,
    content,
  };

  cache.set(absoluteDir, result);
  return result;
}

/**
 * Clear the instruction cache
 * Useful for testing or when files may have changed
 */
export function clearInstructionCache(): void {
  cache.clear();
}

/**
 * Clear cache for a specific directory
 */
export function clearInstructionCacheFor(dir: string): void {
  const absoluteDir = path.resolve(dir);
  cache.delete(absoluteDir);
}

/**
 * Get all supported instruction file names
 */
export function getInstructionFileNames(): readonly string[] {
  return INSTRUCTION_FILES;
}
