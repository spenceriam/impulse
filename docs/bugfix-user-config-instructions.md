# User Instructions Reliability Plan

Issue: [#129](https://github.com/spenceriam/impulse/issues/129)
Branch: `codex/fix-user-config-instructions`

## Outcome

Make user-level instructions reliable from authoring through provider delivery. Users must be able to paste Markdown, import an `@path`, or describe instructions in natural language without manually escaping JSON, losing content after the first newline, or granting an agent unrestricted permissions.

## Confirmed Current Behavior

- `src/util/config.ts` reads `~/.impulse/config.json` with strict `JSON.parse()` and stores custom instructions as an inline JSON string.
- `src/index.ts` collects custom instructions through `readline.question()`, so a newline ends the answer and a multiline paste can save only its first line.
- `/user` stops the TUI and reuses that same single-line onboarding flow.
- `src/cli/prompt-input.ts` already normalizes CRLF and supports multiline paste payloads in the main prompt.
- `src/agent/prompts.ts` formats `userProfile.customInstructions` and appends the result to the generated system prompt.

The implementation exists, but five reliability gaps remain:

1. Raw Markdown must be JSON-escaped; invalid quotes or line breaks can make the whole config unreadable and prevent startup.
2. Multiline paste is incompatible with the current single-line onboarding prompt.
3. The injected prompt does not identify the user config as its source, so the model may incorrectly deny that persistent instructions were loaded.
4. The process-wide config and prompt caches can retain older instructions after an external edit.
5. Tests cover formatting in isolation but not the full path from persistent storage to the provider system message.

## Design Decisions

- Store long-form user instructions in `~/.impulse/user-instructions.md`. The distinct name avoids confusion with the existing project-level `.impulse/instructions.md` file.
- Keep `userProfile.customInstructions` as a backward-compatible fallback during migration, not as the long-term editing surface.
- Treat an explicit command or natural-language request to replace, append, import, or clear instructions as authorization for that exact action.
- Do not launch a background agent or enable allow-all. Use a dedicated tool that can modify only the canonical user-instructions file.

## Implementation Plan

### 1. Add canonical Markdown storage and migration

- Add a user-instructions storage module responsible for reading, validating, and atomically writing `~/.impulse/user-instructions.md`.
- Normalize CRLF and lone carriage returns to LF while preserving Markdown structure and intentional blank lines.
- On first load, use the Markdown file when present; otherwise read the legacy inline `customInstructions` value.
- On the first successful edit or import, write the canonical Markdown file and preserve backward compatibility without duplicating instruction content in the system prompt.
- Define deterministic precedence between user-level Markdown, legacy inline instructions, and project instruction files.

### 2. Replace single-line instruction authoring

- Add an `/instructions` workflow inside the TUI rather than dropping into `readline.question()`.
- Reuse or extract the existing multiline paste normalization from `PromptInput`.
- Support view, replace, append, clear, and multiline paste operations.
- Show the destination path and a compact preview before returning to chat; the user's explicit action is the authorization, so no second permission gate is required.
- Route custom-instruction editing from `/user` into this workflow instead of rerunning all onboarding questions.

### 3. Support explicit `@path` import and agent-assisted authoring

- Accept a command such as `/instructions import @path` for local Markdown or text files.
- Add a narrowly scoped `user_instructions` tool with read, replace, append, import, and clear actions; writes are restricted to `~/.impulse/user-instructions.md`.
- Allow natural-language requests such as "Review `@AGENTS.md`, extract my personal preferences, and save them as my instructions."
- Require explicit save/import intent; merely mentioning an `@path` must not modify persistent instructions.
- Perform the work in the active turn. Do not create a background session or grant general allow-all permissions.

### 4. Harden runtime loading, provenance, and config recovery

- Refresh prompt-relevant config and user-instruction content at the start of every user turn using an mtime-aware cache or explicit fresh-load path.
- Label the generated prompt block with its user-level source so the model can accurately explain where its instructions came from.
- Include a stable fingerprint of the effective instructions in the prompt-cache key and use one canonical key for cache reads and writes.
- Make config saves atomic and preserve a last-known-good backup before replacement.
- If `config.json` is malformed, preserve the original file and show its path plus a useful parse/validation error instead of silently overwriting it with defaults.

### 5. Add regression coverage

- Unit-test newline normalization, Markdown preservation, precedence, migration, and atomic storage.
- Test multiline paste through the instruction editor, including headings, lists, quotes, code fences, CRLF, and blank lines.
- Test replace, append, clear, and `@path` import behavior, including explicit-intent enforcement and target-path containment.
- Add integration coverage proving that new and resumed chats place the exact effective instructions in the provider's first system message.
- Test external edits between turns, invalid JSON recovery, prompt-cache invalidation, and absence of provider secrets in prompts or logs.

## Required Behavior

- [x] Pasting a multiline Markdown document preserves the complete document rather than only its first line.
- [x] Users never need to escape Markdown for JSON manually.
- [x] `/instructions import @path` imports a selected file without a general permission or allow-all prompt.
- [x] An explicit natural-language request can generate and save instructions through the scoped tool.
- [x] New and resumed chats receive the same current user-level instructions.

## Safety and Regression Requirements

- [x] Mentioning a file without explicit save/import intent cannot change persistent instructions.
- [x] The instruction tool cannot write outside `~/.impulse/user-instructions.md`.
- [x] External instruction edits affect the next turn without restarting Impulse.
- [x] Malformed `config.json` is preserved, diagnosed clearly, and never silently replaced with defaults.
- [x] Provider credentials and unrelated config fields never enter the system prompt, tool output, or logs.

## Verification

1. Run focused config, instruction-storage, prompt, paste, and tool tests.
2. Run `bun run typecheck`.
3. Run `bun test`.
4. Run `bun run build`.
5. Manually test multiline paste, `@path` import, natural-language generation, external edits, session resume, and malformed-config recovery.

## Boundaries

- Project instructions remain separate: `.impulse/instructions.md`, `AGENTS.md`, and other repository-level files keep their existing discovery behavior.
- Remote repositories can be researched with existing agent tools, but only an explicit user request may persist the extracted result as user instructions.
- The feature does not grant blanket filesystem access or bypass permissions for unrelated actions.
- The GitHub issue remains a concise problem statement; implementation detail lives in this plan.
