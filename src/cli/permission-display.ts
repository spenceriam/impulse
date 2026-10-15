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

/** Rich permission detail block (modal redesign, #165/#169 dogfood). */
export type PermissionDetails = {
  /** True when a rich block was derived (bash write ops, file write/edit). */
  enriched: boolean;
  /** Derived action phrase ("Write file") — replaces "execute command: …". */
  action: string;
  /** Full command, untruncated (bash only). */
  command?: string;
  /** Absolute target path when known. */
  target?: string | undefined;
  /**
   * Exactly what happens, plus the policy reason — e.g. "Creates a new file
   * (overwrites it if it exists); the target is outside your working
   * directory (~/impulse)". This is the only prose row.
   */
  justification?: string;
};

/** Tokens that look like filesystem paths. */
function pathTokens(command: string): string[] {
  return command
    .split(/\s+/)
    .map((t) => t.replace(/^["']+|["',;]+$/g, ""))
    .filter((t) => /^(~|\/|\.\/|\.\.\/)/.test(t) || /^[A-Za-z]:[\\/]/.test(t));
}

function homeTilde(p: string): string {
  const home = process.env["HOME"] ?? "";
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** Plural kinds for wildcard session grants ("all commands", not "all execute command"). */
const PLURAL_KIND: Record<string, string> = {
  "execute command": "commands",
  "edit file": "file edits",
  "create file": "file writes",
  "launch subagent": "subagent launches",
  "access path outside working directory": "outside-cwd accesses",
};

/**
 * What "Allow session" actually grants (#170). Verb-first plain English:
 * "Allow writes to /tmp (this session)", never "Allow session (writes to
 * /tmp)" — the scope-in-parentheses order reads backwards.
 */
export function sessionScopeLabel(
  request: PermissionRequest,
  wildcard: boolean
): string {
  const kind = getPermissionLabel(request.permission).toLowerCase();
  const pattern = request.patterns[0] ?? "";
  if (wildcard) {
    return `Allow all ${PLURAL_KIND[kind] ?? `${kind}s`} (this session)`;
  }
  if (pattern.startsWith("write:")) {
    return `Allow writes to ${homeTilde(pattern.slice("write:".length))} (this session)`;
  }
  if (request.permission === "bash") return "Allow this exact command (this session)";
  if (kind === "edit file" || kind === "create file") return "Allow this file (this session)";
  return "Allow this action (this session)";
}

type DerivedBash = {
  action: string;
  command?: string;
  target?: string | undefined;
  /** Exactly what the command does ("Creates a new file; overwrites…"). */
  happening: string;
};

function bashDetails(command: string): DerivedBash | null {
  const redir = command.match(/(?:^|\s)(>>?)\s*["']?([^\s"'|>]+)/);
  if (redir) {
    const append = redir[1] === ">>";
    return {
      action: append ? "Append to file" : "Write file",
      command,
      target: redir[2],
      happening: append
        ? "Appends to the file if it exists; creates it if missing"
        : "Creates a new file; overwrites it if it already exists",
    };
  }
  const lastPath = (cmd: string): string | undefined => {
    const paths = pathTokens(cmd);
    return paths[paths.length - 1];
  };
  if (/\bcp\b/.test(command)) {
    return { action: "Copy files", command, target: lastPath(command), happening: "Writes to the target; overwrites it if it exists" };
  }
  if (/\bmv\b/.test(command)) {
    return { action: "Move files", command, target: lastPath(command), happening: "Moves the file(s); overwrites the target if it exists" };
  }
  if (/\bmkdir\b/.test(command)) {
    return { action: "Create directories", command, target: pathTokens(command).join(", "), happening: "Creates new directories" };
  }
  if (/\btouch\b/.test(command)) {
    return { action: "Touch file", command, target: pathTokens(command).join(", "), happening: "Creates the file if missing; updates its timestamp if it exists" };
  }
  if (/\btee\b/.test(command)) {
    return { action: "Write file", command, target: lastPath(command), happening: "Writes the command's output to the file; overwrites if it exists" };
  }
  if (/\bsed\s+-i\b/.test(command)) {
    return { action: "Edit file in place", command, target: lastPath(command), happening: "Rewrites the file with the substitution applied" };
  }
  if (/\b(npm|yarn|pnpm|bun)\s+(install|add|remove|uninstall)\b/.test(command)) {
    return { action: "Change dependencies", command, happening: "Downloads and writes packages into this project and its lockfile" };
  }
  const git = command.match(/\bgit\s+(clone|commit|push|pull|merge|rebase|apply|am|checkout|restore|clean|reset)\b/);
  if (git) {
    const map: Record<string, [string, string]> = {
      clone: ["Clone repository", "Downloads a repository and writes it to disk"],
      commit: ["Commit changes", "Records staged changes as a new commit"],
      push: ["Push commits", "Publishes commits to the remote repository"],
      pull: ["Pull changes", "Fetches and merges remote changes into your branch"],
      merge: ["Merge branch", "Merges changes into your current branch"],
      rebase: ["Rebase branch", "Rewrites your branch onto another base"],
      apply: ["Apply patch", "Writes patch changes to your working tree"],
      am: ["Apply patch series", "Applies mailed patches as commits"],
      checkout: ["Checkout", "Switches branches or restores files"],
      restore: ["Restore files", "Restores files from another commit or the index"],
      clean: ["Clean untracked files", "Deletes untracked files from the working tree"],
      reset: ["Reset state", "Moves the branch pointer and may rewrite the working tree"],
    };
    const [action, happening] = map[git[1]!]!;
    return { action, command, target: lastPath(command), happening };
  }
  if (/\bcurl\b[^|]*\s(?:-o|-O|--output)\b/.test(command)) {
    const out = command.match(/(?:-o|--output)\s*["']?([^\s"']+)/);
    return { action: "Download file", command, target: out?.[1], happening: "Writes the response body to disk" };
  }
  if (/\bwget\b[^|]*\s(?:-O|--output-document)\b/.test(command)) {
    const out = command.match(/(?:-O|--output-document=?)\s*["']?([^\s"']+)/);
    return { action: "Download file", command, target: out?.[1], happening: "Writes the response body to disk" };
  }
  if (/\b(unzip|tar|zip)\b/.test(command)) {
    return { action: "Extract or create archive", command, happening: "Writes extracted/archived files to disk" };
  }
  return null;
}

/**
 * Justification = exactly what happens (the happening sentence) + the policy
 * reason in plain terms. The happening comes first — that is what the user
 * is approving (#169).
 */
function composeJustification(happening: string, reason: string, cwd: string): string {
  const policy = /outside working directory|outside (cwd|the project working directory)/i.test(
    reason
  )
    ? `the target is outside your working directory (${homeTilde(cwd)})`
    : /high-risk/i.test(reason)
      ? "high-risk commands need approval"
      : /write\/mutating/i.test(reason)
        ? "write commands need approval"
        : reason;
  return `${happening}; ${policy}`;
}

/**
 * Structured detail block for the permission modal. Derived lines for bash
 * write ops and file write/edit; anything else falls back to today's short
 * action + reason (enriched=false), so the modal never gets worse (#169).
 */
export function formatPermissionDetails(request: PermissionRequest): PermissionDetails {
  const meta = request.metadata ?? {};
  const reason = formatPermissionReason(request);
  const cwd = process.cwd();

  if (request.permission === "bash" && typeof meta["command"] === "string") {
    const derived = bashDetails(String(meta["command"]).trim());
    if (derived) {
      return {
        enriched: true,
        ...derived,
        justification: composeJustification(derived.happening, reason, cwd),
      };
    }
    return { enriched: false, action: formatPermissionAction(request), justification: reason };
  }

  if (request.permission === "write" || request.permission === "edit") {
    const target =
      typeof meta["path"] === "string" ? String(meta["path"]) : request.patterns[0];
    const isNew = meta["isNewFile"] === true;
    const happening =
      request.permission === "edit"
        ? "Applies a code edit to the existing file"
        : isNew
          ? "Creates a new file"
          : "Overwrites the existing file";
    return {
      enriched: true,
      action:
        request.permission === "edit" ? "Edit file" : isNew ? "Create file" : "Overwrite file",
      ...(target !== undefined ? { target } : {}),
      justification: composeJustification(happening, reason, cwd),
    };
  }

  return { enriched: false, action: formatPermissionAction(request), justification: reason };
}
