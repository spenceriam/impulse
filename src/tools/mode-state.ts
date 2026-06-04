/**
 * Global mode state for tool handlers
 * 
 * This module provides a simple way for tool handlers to access the current mode
 * without needing to pass it through the entire execution chain.
 * 
 * The mode is set by the CLI renderer before each API call and read by tools that need
 * mode-aware behavior (like file_write restrictions in PLAN mode).
 */

import type { MODES } from "../constants";
import { SessionManager } from "../session/manager.js";
import { validatePlanWritePath } from "../plan/revisions.js";

type Mode = typeof MODES[number];

let currentMode: Mode = "AGENT";

/**
 * Set the current mode (called by the CLI renderer before API calls)
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
  return currentMode === "AGENT" || currentMode === "DEBUG";
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
  if (mode === "AGENT" || mode === "DEBUG") {
    return null;
  }
  
  // EXPLORE mode cannot write at all
  if (mode === "EXPLORE") {
    return "EXPLORE mode is read-only. Switch to WORK mode to write files.";
  }
  
  if (mode === "PLAN") {
    const sessionId = SessionManager.getCurrentSessionID();
    if (!sessionId) {
      return "PLAN mode requires an active session to write plan files.";
    }
    return validatePlanWritePath(filePath, sessionId);
  }
  
  return null; // Unknown mode, allow by default
}
