/**
 * Global mode state for tool handlers
 * 
 * This module provides a simple way for tool handlers to access the current mode
 * without needing to pass it through the entire execution chain.
 * 
 * The mode is set by the CLI renderer before each API call and read by tools that need
 * mode-aware behavior (such as ASK write denial).
 */

import { DEFAULT_MODE, type MODES } from "../constants";
import {
  isExecutionAdmissionOpen,
  reopenExecutionAdmissionAfterFailure,
  setAskExecutionAdmission,
} from "./execution-admission.js";
import { currentExecutionContext, isIsolatedMutationContext } from "../execution/context.js";
type Mode = typeof MODES[number];

let currentMode: Mode = DEFAULT_MODE;

/**
 * Set the current mode (called by the CLI renderer before API calls)
 */
export function setCurrentMode(mode: Mode): boolean {
  const runtime = currentExecutionContext()?.runtime;
  if (runtime) {
    runtime.setMode(mode);
    return true;
  }
  if (mode === "AGENT") {
    if (!isExecutionAdmissionOpen()) return false;
    currentMode = mode;
    return true;
  }

  currentMode = "ASK";
  setAskExecutionAdmission();
  return true;
}

/** Reopen a lifecycle-closed gate only when AGENT was already the current authority. */
export function restoreAgentAuthorityAfterLifecycle(): boolean {
  if (getCurrentMode() !== "AGENT") return false;
  if (currentExecutionContext()?.runtime) return true;
  reopenExecutionAdmissionAfterFailure();
  return true;
}

/**
 * Get the current mode (called by tool handlers)
 */
export function getCurrentMode(): Mode {
  return currentExecutionContext()?.runtime?.getMode() ?? currentMode;
}

/**
 * Check if the current mode allows write operations
 */
export function canWriteFiles(): boolean {
  return getCurrentMode() === "AGENT";
}

/**
 * Validate if a file path is allowed for the current mode
 * Returns an error message if not allowed, null if allowed
 */
export function validateWritePath(filePath: string): string | null {
  const mode = getCurrentMode();
  
  // Execution modes can write anywhere
  if (mode === "AGENT") {
    return null;
  }

  if (isIsolatedMutationContext()) {
    return null;
  }

  return `ASK mode is read-only. Ask the user to switch to AGENT before writing ${filePath}.`;
}
