# github_issue

Read a GitHub issue using GitHub CLI (`gh`). **Requires `gh` installed and authenticated** — no web_fetch fallback inside this tool.

## Parameters

- `number` (required): Issue number
- `owner`, `repo` (optional): default to workspace repo from Repository context
- `url` (optional): full issue URL (parses owner/repo/number)

## When to use

- User asks about **issue #N** in the current project and `gh` is available
- Prefer over blind `web_search` for issue numbers

## When gh is unavailable

The tool returns the canonical issue URL. Use `web_fetch` on that URL, or install/auth `gh`.

## PLAN mode

Available in PLAN (read-only). Does not require bash.