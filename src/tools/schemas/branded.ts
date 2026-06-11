import { z } from "zod";
import { hasDegeneratePathMarkdown } from "../input-repair/path-markdown";

export type FilePath = z.BRAND<"FilePath">;
export type CommandString = z.BRAND<"CommandString">;
export type GlobPattern = z.BRAND<"GlobPattern">;
export type CodeEdit = z.BRAND<"CodeEdit">;

/** File or directory path — plain text, not Markdown links. */
export function zFilePath() {
  return z
    .string()
    .refine((val) => !hasDegeneratePathMarkdown(val), {
      message: "Path must be plain text, not a Markdown link",
    })
    .describe(
      "File or directory path (relative or absolute). Plain path text only — do not wrap in Markdown links."
    )
    .brand<"FilePath">();
}

/** Shell command string — not a file path. */
export function zCommandString() {
  return z
    .string()
    .describe(
      "Shell command to execute. Provide the command text only, not a file path or Markdown."
    )
    .brand<"CommandString">();
}

/** Glob pattern (e.g. star-star slash star dot ts). */
export function zGlobPattern() {
  return z
    .string()
    .refine((val) => !hasDegeneratePathMarkdown(val), {
      message: "Glob pattern must be plain text, not a Markdown link",
    })
    .describe("Glob pattern (e.g. **/*.ts, src/**/*.md). Not a file path.")
    .brand<"GlobPattern">();
}

/** Exact file content snippet used for search/replace edits. */
export function zCodeEdit() {
  return z
    .string()
    .min(1, "must not be empty")
    .describe(
      "Exact text snippet from the file to find or replace. Must match file content precisely, including whitespace."
    )
    .brand<"CodeEdit">();
}
