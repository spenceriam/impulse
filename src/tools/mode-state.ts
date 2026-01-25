/**
 * Global mode state for tool handlers
 * 
 * This module provides a simple way for tool handlers to access the current mode
 * without needing to pass it through the entire execution chain.
 * 
 * The mode is set by App.tsx before each API call and read by tools that need
 * mode-aware behavior (like file_write for PLANNER/PLAN-PRD restrictions).
 */

import type { MODES } from "../constants";

type Mode = typeof MODES[number];

let currentMode: Mode = "AUTO";

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
 * Check if the current mode allows write operations
 */
export function canWriteFiles(): boolean {
  return currentMode === "AGENT" || currentMode === "DEBUG" || currentMode === "AUTO";
}

/**
 * Check if the current mode is PLANNER (docs/ only)
 */
export function isPlannerMode(): boolean {
  return currentMode === "PLANNER";
}

/**
 * Check if the current mode is PLAN-PRD (PRD.md only)
 */
export function isPlanPrdMode(): boolean {
  return currentMode === "PLAN-PRD";
}

/**
 * Validate if a file path is allowed for the current mode
 * Returns an error message if not allowed, null if allowed
 */
export function validateWritePath(filePath: string): string | null {
  const mode = getCurrentMode();
  
  // Execution modes can write anywhere
  if (mode === "AGENT" || mode === "DEBUG" || mode === "AUTO") {
    return null;
  }
  
  // EXPLORE mode cannot write at all
  if (mode === "EXPLORE") {
    return "EXPLORE mode is read-only. Switch to AGENT mode to write files.";
  }
  
  // PLANNER mode can only write to docs/
  if (mode === "PLANNER") {
    // Normalize path for comparison
    const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
    const cwd = process.cwd().replace(/\\/g, "/").toLowerCase();
    
    // Check if path is in docs/ directory
    const relativePath = normalizedPath.startsWith(cwd) 
      ? normalizedPath.slice(cwd.length).replace(/^\//, "")
      : normalizedPath;
    
    if (relativePath.startsWith("docs/") || relativePath.startsWith("docs\\")) {
      return null;
    }
    
    return `PLANNER mode can only write to docs/ directory. Requested path: ${filePath}. Switch to AGENT mode to write elsewhere.`;
  }
  
  // PLAN-PRD mode can only write PRD.md
  if (mode === "PLAN-PRD") {
    // Normalize path for comparison
    const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
    
    // Check if path ends with prd.md
    if (normalizedPath.endsWith("/prd.md") || normalizedPath.endsWith("\\prd.md") || normalizedPath === "prd.md") {
      return null;
    }
    
    return `PLAN-PRD mode can only write PRD.md. Requested path: ${filePath}. Switch to AGENT mode to write other files.`;
  }
  
  return null; // Unknown mode, allow by default
}
