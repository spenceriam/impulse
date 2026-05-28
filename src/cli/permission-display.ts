import type { PermissionRequest } from "../permission/index.js";

/** Build Why / Policy lines for permission overlay from request metadata. */
export function formatPermissionWhyPolicy(request: PermissionRequest): {
  why?: string;
  policy?: string;
} {
  const meta = request.metadata ?? {};
  const description =
    typeof meta["description"] === "string" ? String(meta["description"]).trim() : "";
  const message = request.message.trim();
  const reason = typeof meta["reason"] === "string" ? String(meta["reason"]).trim() : "";

  let why = description;
  if (!why && message && !message.startsWith("Execute:") && !message.includes("outside cwd")) {
    why = message;
  }

  let policy = reason;
  if (policy && why && policy.toLowerCase() === why.toLowerCase()) {
    policy = "";
  }

  return {
    ...(why ? { why } : {}),
    ...(policy ? { policy } : {}),
  };
}
