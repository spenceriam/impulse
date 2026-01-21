import { z } from "zod";

/**
 * Permission types for tool execution
 */

/**
 * Permission action - what to do with a permission request
 */
export const PermissionAction = z.enum(["allow", "deny", "ask"]);
export type PermissionAction = z.infer<typeof PermissionAction>;

/**
 * Permission response - user's reply to a permission request
 */
export const PermissionResponse = z.enum(["once", "always", "reject"]);
export type PermissionResponse = z.infer<typeof PermissionResponse>;

/**
 * Permission request - sent when a tool needs permission
 */
export const PermissionRequest = z.object({
  id: z.string(),
  sessionID: z.string(),
  permission: z.string(), // Tool type: "edit", "bash", "task", etc.
  patterns: z.array(z.string()), // File paths, commands, etc.
  message: z.string(), // Human-readable description
  metadata: z.record(z.string(), z.any()).optional(), // Tool-specific data (diff, command, etc.)
  tool: z.object({
    messageID: z.string(),
    callID: z.string(),
  }).optional(),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

/**
 * Permission types that require user approval
 */
export const PERMISSION_TYPES = {
  edit: "Edit file",
  write: "Create file",
  bash: "Execute command",
  task: "Launch subagent",
} as const;

export type PermissionType = keyof typeof PERMISSION_TYPES;
