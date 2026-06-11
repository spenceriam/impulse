import {
  getPermissionLabel,
  type PermissionRequest,
} from "../permission/index.js";

const ACTION_TARGET_MAX = 40;
const REASON_MAX = 120;

/** Truncate plain text for overlay display with ellipsis. */
export function capOverlayText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return "…";
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Short action line: tool type + truncated target (~40 chars). */
export function formatPermissionAction(request: PermissionRequest): string {
  const meta = request.metadata ?? {};
  const kind = getPermissionLabel(request.permission).toLowerCase();

  if (request.permission === "bash" && typeof meta["command"] === "string") {
    const cmd = String(meta["command"]).trim();
    return `${kind}: ${capOverlayText(cmd, ACTION_TARGET_MAX)}`;
  }

  const path =
    request.patterns[0] ??
    (typeof meta["path"] === "string" ? String(meta["path"]) : "") ??
    "";
  const target = path.trim();
  if (target) {
    const short =
      target.length > ACTION_TARGET_MAX
        ? `…${target.slice(-(ACTION_TARGET_MAX - 1))}`
        : target;
    return `${kind}: ${short}`;
  }

  return kind;
}

/** User-facing reason from metadata.reason, description, or message. */
export function formatPermissionReason(
  request: PermissionRequest,
  max = REASON_MAX
): string {
  const meta = request.metadata ?? {};
  const reason =
    (typeof meta["reason"] === "string" ? meta["reason"].trim() : "") ||
    (typeof meta["description"] === "string" ? meta["description"].trim() : "") ||
    request.message.trim();
  if (!reason) {
    return "The agent wants to perform this action.";
  }
  return capOverlayText(reason, max);
}

/** Legacy Why/Policy — only when they add info beyond the reason line. */
export function formatPermissionWhyPolicy(request: PermissionRequest): {
  why?: string;
  policy?: string;
} {
  const reason = formatPermissionReason(request, REASON_MAX);
  const meta = request.metadata ?? {};
  const description =
    typeof meta["description"] === "string" ? String(meta["description"]).trim() : "";
  const message = request.message.trim();

  let why = "";
  if (description && description.toLowerCase() !== reason.toLowerCase()) {
    why = capOverlayText(description, REASON_MAX);
  } else if (
    message &&
    !message.startsWith("Execute:") &&
    !message.includes("outside cwd") &&
    message.toLowerCase() !== reason.toLowerCase()
  ) {
    why = capOverlayText(message, REASON_MAX);
  }

  return why ? { why } : {};
}
