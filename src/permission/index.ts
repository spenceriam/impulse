import { z } from "zod";
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
 * When Express mode is OFF, tools call Permission.ask() before executing.
 * When Express mode is ON, Permission.ask() returns immediately.
 */

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
 * Approved patterns per session
 * Map of sessionID -> Map of permission type -> Set of patterns
 */
const approvedPatterns = new Map<string, Map<string, Set<string>>>();

/**
 * Express mode state
 */
let expressMode = false;
let expressAcknowledged = false;

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
 * Check if a pattern is already approved for this session
 */
function isApproved(sessionID: string, permission: string, pattern: string): boolean {
  const sessionApprovals = approvedPatterns.get(sessionID);
  if (!sessionApprovals) return false;
  
  const permissionApprovals = sessionApprovals.get(permission);
  if (!permissionApprovals) return false;
  
  // Check for exact match or wildcard
  return permissionApprovals.has(pattern) || permissionApprovals.has("*");
}

/**
 * Add approved pattern for session
 */
function addApproval(sessionID: string, permission: string, pattern: string): void {
  if (!approvedPatterns.has(sessionID)) {
    approvedPatterns.set(sessionID, new Map());
  }
  const sessionApprovals = approvedPatterns.get(sessionID)!;
  
  if (!sessionApprovals.has(permission)) {
    sessionApprovals.set(permission, new Set());
  }
  sessionApprovals.get(permission)!.add(pattern);
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
  message?: string;
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
      // Allow this specific request
      pending.resolve();
      break;
      
    case "always":
      // Add patterns to approved list and allow
      for (const pattern of pending.request.patterns) {
        addApproval(pending.request.sessionID, pending.request.permission, pattern);
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
  approvedPatterns.delete(sessionID);
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
