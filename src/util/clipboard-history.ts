/**
 * Clipboard History Module
 * 
 * Stores copied content within a session for /clipboard command.
 * Maximum 20 items, cleared on session reset.
 */

interface ClipboardEntry {
  content: string;
  timestamp: number;
}

// In-memory storage for clipboard history
let history: ClipboardEntry[] = [];
const MAX_HISTORY = 20;

/**
 * Add content to clipboard history
 */
export function addToClipboardHistory(content: string): void {
  if (!content.trim()) return;
  
  // Add to front of list
  history = [
    { content, timestamp: Date.now() },
    ...history.filter(e => e.content !== content)  // Remove duplicates
  ].slice(0, MAX_HISTORY);
}

/**
 * Get all clipboard history entries
 */
export function getClipboardHistory(): ClipboardEntry[] {
  return [...history];
}

/**
 * Clear clipboard history (e.g., on session reset)
 */
export function clearClipboardHistory(): void {
  history = [];
}

/**
 * Get clipboard history count
 */
export function getClipboardHistoryCount(): number {
  return history.length;
}
