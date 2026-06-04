# install_skill

Install a **single** agent skill via `npx skills@latest add` (non-interactive, `-y`).

## Parameters

- `source` (required): Full skill path or GitHub tree URL — **not** the repo root alone
  - Good: `mattpocock/skills/skills/engineering/grill-with-docs`
  - Bad: `mattpocock/skills` (rejected; would install all skills)
- `global` (optional): install globally (`-g`) when supported

## Behavior

- Normalizes GitHub `tree/` and `blob/` URLs to `owner/repo/path/to/skill`
- Skips `npx` when `.agents/skills/<skill>/SKILL.md` already exists
- Verifies `SKILL.md` exists after install
- Returns the path to `SKILL.md` and reminds the agent to use the **question** tool for interview flows

## Notes

- Available in PLAN mode without enabling full `bash`
- Requires permission approval (same as shell commands)
- After install, read and follow `SKILL.md`; grilling skills must use `question`, not chat markdown