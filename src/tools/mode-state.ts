/**
 * Global mode state for tool handlers
 * 
 * This module provides a simple way for tool handlers to access the current mode
 * without needing to pass it through the entire execution chain.
 * 
 * The mode is set by App.tsx before each API call and read by tools that need
 * mode-aware behavior (like file_write restrictions in PLAN mode).
 */

import type { MODES } from "../constants";

type Mode = typeof MODES[number];

let currentMode: Mode = "WORK";

/**
 * Set the current mode (called by App.tsx before API calls)
 */
export function setCurrentMode(mode: Mode): void {
  currentMode = mode;
}

/**
 * Get the current mode (called by tool handlers)
 */
export function getCurrentMode(): Mode {
  return currentMode;
}

/**
 * Legacy AUTO approval gate compatibility (no-op after AUTO removal)
 */
export function isAutoApprovalGranted(): boolean {
  return true;
}

export function setAutoApprovalGranted(_value: boolean): void {
  // No-op: AUTO mode no longer exists.
}

export function resetAutoApproval(): void {
  // No-op: AUTO mode no longer exists.
}

/**
 * Check if the current mode allows write operations
 */
export function canWriteFiles(): boolean {
  return currentMode === "WORK" || currentMode === "DEBUG";
}

/**
 * Check if the current mode is PLAN.
 */
export function isPlannerMode(): boolean {
  return currentMode === "PLAN";
}

/**
 * Legacy PLAN-PRD compatibility helper.
 */
export function isPlanPrdMode(): boolean {
  return false;
}

/**
 * Validate if a file path is allowed for the current mode
 * Returns an error message if not allowed, null if allowed
 */
export function validateWritePath(filePath: string): string | null {
  const mode = getCurrentMode();
  
  // Execution modes can write anywhere
  if (mode === "WORK" || mode === "DEBUG") {
    return null;
  }
  
  // EXPLORE mode cannot write at all
  if (mode === "EXPLORE") {
    return "EXPLORE mode is read-only. Switch to WORK mode to write files.";
  }
  
  // PLAN mode can only write planning artifacts (docs/ or PRD.md)
  if (mode === "PLAN") {
    // Normalize path for comparison
    const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
    const cwd = process.cwd().replace(/\\/g, "/").toLowerCase();
    
    // Check if path is in docs/ directory
    const relativePath = normalizedPath.startsWith(cwd) 
      ? normalizedPath.slice(cwd.length).replace(/^\//, "")
      : normalizedPath;
    
    if (
      relativePath.startsWith("docs/") ||
      relativePath === "prd.md" ||
      relativePath.endsWith("/prd.md")
    ) {
      return null;
    }
    
    return `PLAN mode can only write to docs/ or PRD.md. Requested path: ${filePath}. Switch to WORK mode to write elsewhere.`;
  }
  
  return null; // Unknown mode, allow by default
}
