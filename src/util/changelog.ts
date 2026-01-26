/**
 * Changelog utility - fetches changelog from GitHub repository
 */

const CHANGELOG_URL = "https://raw.githubusercontent.com/spenceriam/impulse/main/CHANGELOG.md";

/**
 * Fetch the changelog from the GitHub repository
 * @returns The raw markdown content of the changelog
 * @throws Error if fetch fails
 */
export async function fetchChangelog(): Promise<string> {
  const response = await fetch(CHANGELOG_URL, {
    headers: {
      "Accept": "text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Parse changelog into structured entries for display
 * Each entry has a version, date, type, title, and list of changes
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  title: string;
  changes: string[];
}

/**
 * Parse the raw changelog markdown into structured entries
 * @param markdown Raw changelog content
 * @returns Array of parsed changelog entries
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = markdown.split("\n");
  
  let currentEntry: ChangelogEntry | null = null;
  
  for (const line of lines) {
    // Match version headers: ## [0.27.7] - 2026-01-26
    const versionMatch = line.match(/^##\s*\[?(\d+\.\d+\.\d+)\]?\s*[-–]\s*(\d{4}-\d{2}-\d{2})/);
    
    if (versionMatch) {
      // Save previous entry
      if (currentEntry) {
        entries.push(currentEntry);
      }
      
      // Start new entry
      const version = versionMatch[1] || "";
      const date = versionMatch[2] || "";
      
      // Determine type based on version number changes
      const [major, minor, patch] = version.split(".").map(Number);
      let type: "major" | "minor" | "patch" = "patch";
      if (major && major > 0) type = "major";
      else if (minor && minor > 0 && patch === 0) type = "minor";
      
      currentEntry = {
        version,
        date,
        type,
        title: "",
        changes: [],
      };
      continue;
    }
    
    // Match title line (bold text after version header)
    if (currentEntry && !currentEntry.title) {
      const titleMatch = line.match(/^\*\*(.+?)\*\*/);
      if (titleMatch) {
        currentEntry.title = titleMatch[1] || "";
        continue;
      }
    }
    
    // Match change items (bullet points)
    if (currentEntry) {
      const changeMatch = line.match(/^[-*]\s+(.+)/);
      if (changeMatch) {
        currentEntry.changes.push(changeMatch[1] || "");
      }
    }
  }
  
  // Don't forget last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }
  
  return entries;
}
