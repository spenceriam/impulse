/**
 * Image file path detection, resolution, and slash-command disambiguation.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"] as const;
const EXT_PATTERN = IMAGE_EXTENSIONS.join("|");

/** Slash commands from {@link buildSlashCommandList} (first token after `/`). */
export const SLASH_COMMAND_NAMES = new Set([
  "experimental",
  "advisor",
  "update",
  "model",
  "vision",
  "mode",
  "reasoning",
  "think",
  "new",
  "resume",
  "user",
  "debug",
  "help",
  "clear",
  "exit",
  "quit",
  "allow-all",
  "show",
  "speedo",
]);

const PASTED_IMAGE_TOKEN_RE = /\[Pasted images? #\d+(?:-#\d+)?\]/;

/** Paths without spaces (legacy / inline segments). */
const PATH_BODY_RE = new RegExp(
  `(?:` +
    `(?:~\\/|\\.\\.?\\/|[A-Za-z]:[\\\\/]|\\/)` +
    `[^\\s\\n"'\\]]+\\.(?:${EXT_PATTERN})` +
    `|` +
    `[^\\s\\n"'\\]]+\\.(?:${EXT_PATTERN})` +
  `)`,
  "i"
);

/** Paths that may contain spaces (after shell escape normalization). */
const PATH_WITH_SPACES_RE = new RegExp(
  `(?:~\\/|\\.\\.?\\/|[A-Za-z]:[\\\\/]|\\/)[^\\n\\[\\]]+\\.(?:${EXT_PATTERN})`,
  "i"
);

/**
 * Global-flagged variants for {@link String.prototype.matchAll}, which throws
 * a TypeError when given a non-global RegExp. The non-global versions above are
 * retained for stateless `.test()` calls (a global regex would advance
 * `lastIndex` across calls and yield inconsistent results).
 */
const PATH_BODY_RE_GLOBAL = new RegExp(PATH_BODY_RE.source, "gi");
const PATH_WITH_SPACES_RE_GLOBAL = new RegExp(PATH_WITH_SPACES_RE.source, "gi");

const QUOTED_PATH_RE = new RegExp(
  `("([^"]+\\.(?:${EXT_PATTERN}))"|'([^']+\\.(?:${EXT_PATTERN}))')`,
  "gi"
);

const AT_PATH_RE = new RegExp(
  `@((?:~\\/|\\.\\.?\\/|[A-Za-z]:[\\\\/]|\\/)[^\\n\\[\\]]+\\.(?:${EXT_PATTERN})|[^\\s\\n]+\\.(?:${EXT_PATTERN}))`,
  "gi"
);

export type ImagePathRef = {
  start: number;
  end: number;
  raw: string;
  /** Normalized path without leading `@` when applicable */
  path: string;
};

export function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** Unescape shell-style pasted paths (`\ `, quotes). */
export function normalizePathString(raw: string): string {
  let t = stripQuotes(raw.trim());
  t = t.replace(/\\ /g, " ");
  t = t.replace(/\\([ '"()&;])/g, "$1");
  return t.trim();
}

function hasImageExtension(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext as (typeof IMAGE_EXTENSIONS)[number]);
}

export function isImagePathCandidate(text: string): boolean {
  const t = normalizePathString(text);
  if (!t) return false;
  if (PASTED_IMAGE_TOKEN_RE.test(t)) return false;
  if (!hasImageExtension(t)) return false;
  if (t.startsWith("@")) return isImagePathCandidate(t.slice(1));
  if (t.startsWith("file://")) return true;
  if (t.startsWith("data:image/")) return true;
  if (t.startsWith("~/") || t.startsWith("./") || t.startsWith("../")) return true;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.startsWith("/")) return true;
  return PATH_BODY_RE.test(t) || PATH_WITH_SPACES_RE.test(t);
}

/**
 * True when input should route to handleSlash (not a message with a file path).
 */
export function shouldTreatAsSlashCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return false;

  if (isImagePathCandidate(trimmed)) return false;

  const rest = trimmed.slice(1).trim();
  if (!rest) return true;

  const firstWord = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (SLASH_COMMAND_NAMES.has(firstWord)) return true;

  if (isImagePathCandidate(rest)) return false;
  if (isImagePathCandidate(firstWord)) return false;

  return true;
}

function overlapsToken(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start);
  const open = before.lastIndexOf("[Pasted image #");
  if (open === -1) return false;
  const close = text.indexOf("]", open);
  return close !== -1 && close >= end;
}

function wholeLinePathRef(text: string): ImagePathRef | null {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  if (!trimmed || !isImagePathCandidate(trimmed)) return null;
  return {
    start: lead,
    end: lead + trimmed.length,
    raw: trimmed,
    path: normalizePathString(trimmed),
  };
}

/** Find attachable image path spans in message text (excludes existing paste tokens). */
export function extractImagePathRefs(text: string): ImagePathRef[] {
  const whole = wholeLinePathRef(text);
  if (whole && !overlapsToken(text, whole.start, whole.end)) {
    return [whole];
  }

  const refs: ImagePathRef[] = [];
  const seen = new Set<string>();

  const addRef = (start: number, end: number, raw: string, pathStr: string) => {
    const normalized = normalizePathString(pathStr);
    if (!isImagePathCandidate(normalized)) return;
    const key = `${start}:${normalized}`;
    if (seen.has(key)) return;
    if (overlapsToken(text, start, end)) return;
    seen.add(key);
    refs.push({ start, end, raw, path: normalized });
  };

  for (const m of text.matchAll(QUOTED_PATH_RE)) {
    const raw = m[0]!;
    const inner = m[2] ?? m[3] ?? "";
    addRef(m.index!, m.index! + raw.length, raw, inner);
  }

  for (const m of text.matchAll(AT_PATH_RE)) {
    const raw = m[0]!;
    addRef(m.index!, m.index! + raw.length, raw, m[1]!);
  }

  for (const re of [PATH_WITH_SPACES_RE_GLOBAL, PATH_BODY_RE_GLOBAL]) {
    for (const m of text.matchAll(re)) {
      const raw = m[0]!;
      const start = m.index!;
      const end = start + raw.length;
      if (refs.some((r) => start >= r.start && start < r.end)) continue;
      if (raw.startsWith("@")) continue;
      addRef(start, end, raw, raw);
    }
  }

  return refs.sort((a, b) => a.start - b.start);
}

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "jpg") return "image/jpeg";
  if (e === "svg") return "image/svg+xml";
  return `image/${e}`;
}

export type ResolveImagePathResult =
  | { ok: true; uri: string; absolutePath: string }
  | { ok: false; reason: string };

export async function resolveImagePath(
  raw: string,
  cwd: string = process.cwd()
): Promise<ResolveImagePathResult> {
  let p = normalizePathString(raw);
  if (p.startsWith("@")) p = p.slice(1);
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      return { ok: false, reason: `Invalid file URL: ${raw}` };
    }
  }
  if (p.startsWith("data:image/")) {
    return { ok: true, uri: p, absolutePath: p };
  }

  if (p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(2));
  } else if (!path.isAbsolute(p)) {
    p = path.resolve(cwd, p);
  } else {
    p = path.resolve(p);
  }

  const ext = path.extname(p).slice(1).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext as (typeof IMAGE_EXTENSIONS)[number])) {
    return { ok: false, reason: `Not an image file: ${raw}` };
  }

  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) {
      return { ok: false, reason: `Not a file: ${p}` };
    }
  } catch {
    return { ok: false, reason: `Image not found: ${p}` };
  }

  try {
    const buf = await fs.readFile(p);
    const b64 = buf.toString("base64");
    const uri = `data:${mimeForExt(ext)};base64,${b64}`;
    return { ok: true, uri, absolutePath: p };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Failed to read image: ${msg}` };
  }
}

/** Regex for file paths in pasted content (shared with paste detection). */
export function filePathInPasteRegex(): RegExp {
  return new RegExp(PATH_WITH_SPACES_RE.source, "gi");
}
