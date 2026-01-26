import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { Bus } from "../bus";
import { BusEvent } from "../bus/bus";
import {
  PermissionRequest,
  PermissionResponse,
  type PermissionType,
  PERMISSION_TYPES,
} from "./types";

export * from "./types";

/**
 * Permission Module
 * 
 * Handles tool permission requests and responses.
 * Three levels of approval:
 * - once: Allow this specific action only
 * - session: Auto-approve for current session (in-memory)
 * - always: Save to project config (persisted to .impulse/permissions.json)
 * 
 * When Express mode is ON, all permissions are auto-approved.
 */

// Project permissions file path
const PERMISSIONS_FILE = ".impulse/permissions.json";

// Generate unique IDs for permission requests
let permissionIdCounter = 0;
function generatePermissionId(): string {
  return `perm_${Date.now()}_${++permissionIdCounter}`;
}

/**
 * Permission Events
 */
export const PermissionEvents = {
  Asked: BusEvent.define(
    "permission.asked",
    PermissionRequest
  ),
  Replied: BusEvent.define(
    "permission.replied",
    z.object({
      sessionID: z.string(),
      permissionID: z.string(),
      response: PermissionResponse,
      message: z.string().optional(), // Feedback when rejecting
    })
  ),
};

/**
 * Pending permission requests
 * Map of permissionID -> { request, resolve, reject }
 */
interface PendingPermission {
  request: PermissionRequest;
  resolve: () => void;
  reject: (error: Error) => void;
}

const pendingPermissions = new Map<string, PendingPermission>();

/**
 * Session-scoped approved patterns (in-memory)
 * Map of sessionID -> Map of permission type -> Set of patterns
 */
const sessionApprovals = new Map<string, Map<string, Set<string>>>();

/**
 * Project-scoped approved patterns (persisted)
 * Map of permission type -> Set of patterns
 */
let projectApprovals: Map<string, Set<string>> | null = null;

/**
 * Express mode state
 */
let expressMode = false;
let expressAcknowledged = false;

/**
 * Load project permissions from .impulse/permissions.json
 */
function loadProjectPermissions(): Map<string, Set<string>> {
  if (projectApprovals !== null) {
    return projectApprovals;
  }
  
  projectApprovals = new Map();
  
  const filePath = join(process.cwd(), PERMISSIONS_FILE);
  if (!existsSync(filePath)) {
    return projectApprovals;
  }
  
  try {
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as Record<string, string[]>;
    
    for (const [permission, patterns] of Object.entries(data)) {
      projectApprovals.set(permission, new Set(patterns));
    }
  } catch (error) {
    console.error("Failed to load project permissions:", error);
  }
  
  return projectApprovals;
}

/**
 * Save project permissions to .impulse/permissions.json
 */
function saveProjectPermissions(): void {
  if (!projectApprovals) return;
  
  const dirPath = join(process.cwd(), ".impulse");
  const filePath = join(dirPath, "permissions.json");
  
  try {
    // Ensure directory exists
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    
    // Convert Map to JSON-serializable object
    const data: Record<string, string[]> = {};
    for (const [permission, patterns] of projectApprovals) {
      data[permission] = Array.from(patterns);
    }
    
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save project permissions:", error);
  }
}

/**
 * Add project-level approval (persisted)
 */
function addProjectApproval(permission: string, pattern: string): void {
  const approvals = loadProjectPermissions();
  
  if (!approvals.has(permission)) {
    approvals.set(permission, new Set());
  }
  approvals.get(permission)!.add(pattern);
  
  saveProjectPermissions();
}

/**
 * Check if a pattern is approved at project level
 */
function isProjectApproved(permission: string, pattern: string): boolean {
  const approvals = loadProjectPermissions();
  const permissionApprovals = approvals.get(permission);
  if (!permissionApprovals) return false;
  
  // Check for exact match or wildcard
  return permissionApprovals.has(pattern) || permissionApprovals.has("*");
}

/**
 * Check if Express mode is enabled
 */
export function isExpressMode(): boolean {
  return expressMode;
}

/**
 * Check if Express mode has been acknowledged (warning shown)
 */
export function isExpressAcknowledged(): boolean {
  return expressAcknowledged;
}

/**
 * Enable Express mode
 * @returns true if this is the first time enabling (needs warning)
 */
export function enableExpress(): boolean {
  const needsWarning = !expressAcknowledged;
  expressMode = true;
  return needsWarning;
}

/**
 * Acknowledge Express mode (after user sees warning)
 */
export function acknowledgeExpress(): void {
  expressAcknowledged = true;
}

/**
 * Disable Express mode
 */
export function disableExpress(): void {
  expressMode = false;
}

/**
 * Toggle Express mode
 * @returns { enabled: boolean, needsWarning: boolean }
 */
export function toggleExpress(): { enabled: boolean; needsWarning: boolean } {
  if (expressMode) {
    disableExpress();
    return { enabled: false, needsWarning: false };
  } else {
    const needsWarning = enableExpress();
    return { enabled: true, needsWarning };
  }
}

/**
 * Check if a pattern is approved (session or project level)
 */
function isApproved(sessionID: string, permission: string, pattern: string): boolean {
  // Check project-level approvals first (persisted)
  if (isProjectApproved(permission, pattern)) {
    return true;
  }
  
  // Check session-level approvals (in-memory)
  const session = sessionApprovals.get(sessionID);
  if (!session) return false;
  
  const permissionApprovals = session.get(permission);
  if (!permissionApprovals) return false;
  
  // Check for exact match or wildcard
  return permissionApprovals.has(pattern) || permissionApprovals.has("*");
}

/**
 * Add session-level approval (in-memory only)
 */
function addSessionApproval(sessionID: string, permission: string, pattern: string): void {
  if (!sessionApprovals.has(sessionID)) {
    sessionApprovals.set(sessionID, new Map());
  }
  const session = sessionApprovals.get(sessionID)!;
  
  if (!session.has(permission)) {
    session.set(permission, new Set());
  }
  session.get(permission)!.add(pattern);
}

/**
 * Ask for permission to execute a tool
 * 
 * @param input Permission request details
 * @returns Promise that resolves when permission is granted, rejects when denied
 */
export async function ask(input: {
  sessionID: string;
  permission: PermissionType | string;
  patterns: string[];
  message: string;
  metadata?: Record<string, unknown>;
  tool?: { messageID: string; callID: string };
}): Promise<void> {
  // Express mode - auto-approve everything
  if (expressMode) {
    return;
  }
  
  // Check if all patterns are already approved
  const unapprovedPatterns = input.patterns.filter(
    (p) => !isApproved(input.sessionID, input.permission, p)
  );
  
  if (unapprovedPatterns.length === 0) {
    return;
  }
  
  // Create permission request
  const id = generatePermissionId();
  const request: PermissionRequest = {
    id,
    sessionID: input.sessionID,
    permission: input.permission,
    patterns: unapprovedPatterns,
    message: input.message,
    metadata: input.metadata,
    tool: input.tool,
  };
  
  // Create promise that will be resolved/rejected by respond()
  return new Promise<void>((resolve, reject) => {
    pendingPermissions.set(id, { request, resolve, reject });
    
    // Publish event to show UI
    Bus.publish(PermissionEvents.Asked, request);
  });
}

/**
 * Respond to a permission request
 * 
 * @param input Response details
 */
export function respond(input: {
  permissionID: string;
  response: PermissionResponse;
  message?: string | undefined;
  wildcard?: boolean | undefined;  // For "Allow session (tool/*)" - approves all actions of this type
}): void {
  const pending = pendingPermissions.get(input.permissionID);
  if (!pending) {
    console.warn(`Permission ${input.permissionID} not found`);
    return;
  }
  
  pendingPermissions.delete(input.permissionID);
  
  // Publish reply event
  Bus.publish(PermissionEvents.Replied, {
    sessionID: pending.request.sessionID,
    permissionID: input.permissionID,
    response: input.response,
    message: input.message,
  });
  
  switch (input.response) {
    case "once":
      // Allow this specific request only
      pending.resolve();
      break;
      
    case "session":
      // Add patterns to session-level approvals (in-memory)
      if (input.wildcard) {
        // Wildcard: approve all actions of this permission type for the session
        addSessionApproval(pending.request.sessionID, pending.request.permission, "*");
      } else {
        // Specific: approve only these exact patterns
        for (const pattern of pending.request.patterns) {
          addSessionApproval(pending.request.sessionID, pending.request.permission, pattern);
        }
      }
      pending.resolve();
      break;
      
    case "always":
      // Add patterns to project-level approvals (persisted to .impulse/permissions.json)
      for (const pattern of pending.request.patterns) {
        addProjectApproval(pending.request.permission, pattern);
      }
      pending.resolve();
      break;
      
    case "reject":
      // Reject with error
      const errorMsg = input.message
        ? `Permission denied: ${input.message}`
        : "Permission denied by user";
      pending.reject(new PermissionDeniedError(errorMsg));
      break;
  }
}

/**
 * Get list of pending permission requests
 */
export function listPending(): PermissionRequest[] {
  return Array.from(pendingPermissions.values()).map((p) => p.request);
}

/**
 * Get permission type label
 */
export function getPermissionLabel(permission: string): string {
  return PERMISSION_TYPES[permission as PermissionType] || permission;
}

/**
 * Clear all approvals for a session (e.g., when session ends)
 */
export function clearSessionApprovals(sessionID: string): void {
  sessionApprovals.delete(sessionID);
}

/**
 * Get project permissions (for display/management)
 */
export function getProjectPermissions(): Record<string, string[]> {
  const approvals = loadProjectPermissions();
  const result: Record<string, string[]> = {};
  
  for (const [permission, patterns] of approvals) {
    result[permission] = Array.from(patterns);
  }
  
  return result;
}

/**
 * Remove a project-level approval
 */
export function removeProjectApproval(permission: string, pattern: string): void {
  const approvals = loadProjectPermissions();
  const permissionApprovals = approvals.get(permission);
  
  if (permissionApprovals) {
    permissionApprovals.delete(pattern);
    if (permissionApprovals.size === 0) {
      approvals.delete(permission);
    }
    saveProjectPermissions();
  }
}

/**
 * Clear all project-level approvals
 */
export function clearProjectApprovals(): void {
  projectApprovals = new Map();
  saveProjectPermissions();
}

/**
 * Error thrown when permission is denied
 */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}
