import { glob } from "glob";
import path from "path";
import os from "os";

/**
 * @ Reference Parser
 * Parses @ file/directory references with fuzzy matching and line range support
 */

export interface AtReference {
  fullMatch: string;
  path: string;
  lineRange?: {
    start: number;
    end: number;
  };
}

export interface AtCandidate {
  path: string;
  display: string;
  type: "file" | "directory";
}

/**
 * Parse @ reference from input
 * Supports:
 * - @file - file reference
 * - @~ - home directory expansion
 * - @dir/ - directory reference
 * - @file#10-20 - line range reference
 */
export function parseAtReference(
  input: string,
  cursorPosition: number
): { reference: AtReference | null; position: number } | null {
  // Find @ before cursor
  const beforeCursor = input.slice(0, cursorPosition);
  const atIndex = beforeCursor.lastIndexOf("@");

  if (atIndex === -1) {
    return null;
  }

  // Get reference text after @
  const refText = input.slice(atIndex, cursorPosition);

  // Validate reference (must contain something after @)
  if (refText.length <= 1) {
    return null;
  }

  let filePath = refText.slice(1);
  let lineRange: { start: number; end: number } | undefined;

  // Parse line range (e.g., @file#10-20)
  const lineMatch = filePath.match(/^(.+?)#(\d+)(?:-(\d+))?$/);
  if (lineMatch && lineMatch[1] && lineMatch[2]) {
    filePath = lineMatch[1];
    const start = parseInt(lineMatch[2], 10);
    const end = lineMatch[3] ? parseInt(lineMatch[3], 10) : start;
    lineRange = { start, end };
  }

  // Handle @~ home directory
  if (filePath.startsWith("~")) {
    const homeDir = os.homedir();
    if (homeDir) {
      filePath = path.join(homeDir, filePath.slice(1));
    }
  }

  if (lineRange) {
    return {
      reference: {
        fullMatch: refText,
        path: filePath || "",
        lineRange,
      },
      position: atIndex,
    };
  }

  return {
    reference: {
      fullMatch: refText,
      path: filePath || "",
    },
    position: atIndex,
  };
}

/**
 * Get completion candidates for @ reference
 */
export async function getAtCandidates(
  partialPath: string,
  workingDirectory: string = process.cwd()
): Promise<AtCandidate[]> {
  let searchPath = partialPath;

  // Handle @~ home directory
  if (searchPath.startsWith("~")) {
    searchPath = path.join(os.homedir(), searchPath.slice(1));
  }

  // If path is empty or just ~, use working directory or home
  if (!searchPath || searchPath === "~") {
    searchPath = workingDirectory;
  }

  const candidates: AtCandidate[] = [];

  try {
    // Search for files and directories
    const pattern = path.join(searchPath, "**/*");
    const files = await glob(pattern, {
      nodir: true,
      windowsPathsNoEscape: true,
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
      ],
    });

    const dirPattern = path.join(searchPath, "*/");
    const dirs = await glob(dirPattern, {
      windowsPathsNoEscape: true,
    });

    // Add file candidates
    for (const file of files.slice(0, 50)) {
      const relativePath = path.relative(workingDirectory, file);
      candidates.push({
        path: file,
        display: relativePath,
        type: "file",
      });
    }

    // Add directory candidates
    for (const dir of dirs.slice(0, 20)) {
      const relativePath = path.relative(workingDirectory, dir.slice(0, -1)); // Remove trailing /
      candidates.push({
        path: dir.slice(0, -1),
        display: relativePath + "/",
        type: "directory",
      });
    }
  } catch (error) {
    console.error("Error getting @ candidates:", error);
  }

  return candidates;
}

/**
 * Filter candidates by fuzzy match
 */
export function filterCandidatesByFuzzy(
  candidates: AtCandidate[],
  searchTerm: string
): AtCandidate[] {
  if (!searchTerm) {
    return candidates;
  }

  const lowerSearch = searchTerm.toLowerCase();

  return candidates
    .filter((candidate) => {
      const lowerPath = candidate.display.toLowerCase();
      // Exact match
      if (lowerPath.includes(lowerSearch)) {
        return true;
      }
      // Fuzzy match (all characters in order)
      let searchIndex = 0;
      for (const char of lowerPath) {
        if (char === lowerSearch[searchIndex]) {
          searchIndex++;
          if (searchIndex >= lowerSearch.length) {
            return true;
          }
        }
      }
      return false;
    })
    .slice(0, 10); // Limit to 10 results
}

/**
 * Format reference with line range
 */
export function formatReference(reference: AtReference): string {
  let result = `@${reference.path}`;

  if (reference.lineRange) {
    result += `#${reference.lineRange.start}-${reference.lineRange.end}`;
  }

  return result;
}
