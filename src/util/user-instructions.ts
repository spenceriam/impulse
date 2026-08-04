import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Global } from "../global.js";
import { writeFileAtomic } from "./atomic-write.js";

export const USER_INSTRUCTIONS_FILE = path.join(
  Global.Path.home,
  "user-instructions.md"
);
export const USER_INSTRUCTIONS_DISPLAY_PATH = "~/.impulse/user-instructions.md";
export const MAX_USER_INSTRUCTIONS_BYTES = 256 * 1024;

export type EffectiveUserInstructionsSource = "file" | "legacy_config" | "none";

export interface StoredUserInstructions {
  exists: boolean;
  content: string;
  path: string;
  mtimeMs?: number;
}

export interface EffectiveUserInstructions {
  content: string;
  source: EffectiveUserInstructionsSource;
  sourceLabel: string;
  fingerprint: string;
}

/** Preserve Markdown while making terminal and file line endings deterministic. */
export function normalizeUserInstructions(content: string): string {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function validateUserInstructions(content: string): void {
  if (content.includes("\0")) {
    throw new Error("User instructions cannot contain NUL bytes.");
  }
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > MAX_USER_INSTRUCTIONS_BYTES) {
    throw new Error(
      `User instructions are ${bytes} bytes; the limit is ${MAX_USER_INSTRUCTIONS_BYTES} bytes.`
    );
  }
}

export async function readStoredUserInstructions(
  targetPath: string = USER_INSTRUCTIONS_FILE
): Promise<StoredUserInstructions> {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.size > MAX_USER_INSTRUCTIONS_BYTES) {
      throw new Error(
        `User instructions are ${stat.size} bytes; the limit is ${MAX_USER_INSTRUCTIONS_BYTES} bytes.`
      );
    }
    const raw = await fs.readFile(targetPath, "utf-8");
    const content = normalizeUserInstructions(raw);
    validateUserInstructions(content);
    return { exists: true, content, path: targetPath, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, content: "", path: targetPath };
    }
    throw error;
  }
}

export async function replaceUserInstructions(
  content: string,
  targetPath: string = USER_INSTRUCTIONS_FILE
): Promise<StoredUserInstructions> {
  const normalized = normalizeUserInstructions(content);
  validateUserInstructions(normalized);
  await writeFileAtomic(targetPath, normalized, { mode: 0o600 });
  return readStoredUserInstructions(targetPath);
}

export async function appendUserInstructions(
  content: string,
  targetPath: string = USER_INSTRUCTIONS_FILE
): Promise<StoredUserInstructions> {
  const incoming = normalizeUserInstructions(content);
  validateUserInstructions(incoming);
  const current = await readStoredUserInstructions(targetPath);
  let combined = incoming;
  if (current.exists && current.content.length > 0 && incoming.length > 0) {
    const separator = current.content.endsWith("\n\n")
      ? ""
      : current.content.endsWith("\n")
        ? "\n"
        : "\n\n";
    combined = `${current.content}${separator}${incoming}`;
  } else if (current.exists && incoming.length === 0) {
    combined = current.content;
  }
  return replaceUserInstructions(combined, targetPath);
}

export async function clearUserInstructions(
  targetPath: string = USER_INSTRUCTIONS_FILE
): Promise<StoredUserInstructions> {
  // An existing empty file intentionally overrides the legacy inline value.
  return replaceUserInstructions("", targetPath);
}

/** Resolve a user-explicit `@path`, quoted path, absolute path, or cwd-relative path. */
export function resolveUserInstructionsImportPath(
  input: string,
  cwd: string = process.cwd()
): string {
  let value = input.trim();
  if (value.startsWith("@")) value = value.slice(1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (!value) throw new Error("Provide a Markdown or text file path to import.");

  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(os.homedir(), value.slice(2));
  }
  return path.resolve(cwd, value);
}

export function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolve symlinks before enforcing the workspace boundary for agent imports. */
export async function resolveWorkspaceUserInstructionsImportPath(
  input: string,
  cwd: string = process.cwd()
): Promise<string> {
  const candidate = resolveUserInstructionsImportPath(input, cwd);
  const [realCandidate, realCwd] = await Promise.all([
    fs.realpath(candidate),
    fs.realpath(cwd),
  ]);
  if (!isPathInsideDirectory(realCandidate, realCwd)) {
    throw new Error(`Agent-driven imports are limited to the current workspace: ${realCwd}`);
  }
  return realCandidate;
}

export async function importUserInstructions(
  sourcePathInput: string,
  options?: {
    append?: boolean;
    cwd?: string;
    targetPath?: string;
  }
): Promise<StoredUserInstructions> {
  const sourcePath = resolveUserInstructionsImportPath(
    sourcePathInput,
    options?.cwd
  );
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) {
    throw new Error(`Instruction source is not a file: ${sourcePath}`);
  }
  if (stat.size > MAX_USER_INSTRUCTIONS_BYTES) {
    throw new Error(
      `Instruction source is ${stat.size} bytes; the limit is ${MAX_USER_INSTRUCTIONS_BYTES} bytes.`
    );
  }
  const content = await fs.readFile(sourcePath, "utf-8");
  return options?.append
    ? appendUserInstructions(content, options.targetPath)
    : replaceUserInstructions(content, options?.targetPath);
}

export type UserInstructionsWriteAction = "replace" | "append" | "import" | "clear";

/** Apply one explicit persistent-instruction mutation to the canonical Markdown file. */
export async function writeUserInstructions(
  action: UserInstructionsWriteAction,
  value = "",
  options?: { cwd?: string; targetPath?: string }
): Promise<StoredUserInstructions> {
  if (action === "replace") {
    return replaceUserInstructions(value, options?.targetPath);
  }
  if (action === "append") {
    return appendUserInstructions(value, options?.targetPath);
  }
  if (action === "import") {
    return importUserInstructions(value, options);
  }
  return clearUserInstructions(options?.targetPath);
}

export async function loadEffectiveUserInstructions(
  legacyInline: string | undefined,
  targetPath: string = USER_INSTRUCTIONS_FILE
): Promise<EffectiveUserInstructions> {
  const stored = await readStoredUserInstructions(targetPath);
  const legacy = normalizeUserInstructions(legacyInline ?? "");
  const content = stored.exists ? stored.content : legacy;
  const source: EffectiveUserInstructionsSource = stored.exists
    ? "file"
    : legacy.length > 0
      ? "legacy_config"
      : "none";
  const sourceLabel = source === "file"
    ? USER_INSTRUCTIONS_DISPLAY_PATH
    : source === "legacy_config"
      ? "~/.impulse/config.json"
      : USER_INSTRUCTIONS_DISPLAY_PATH;
  const fingerprint = createHash("sha256")
    .update(`${source}\0${content}`, "utf-8")
    .digest("hex");
  return { content, source, sourceLabel, fingerprint };
}
