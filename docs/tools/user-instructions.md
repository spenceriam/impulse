# user_instructions

Read or update the user's persistent instructions at `~/.impulse/user-instructions.md`.

## Parameters

- `action`: `read`, `replace`, `append`, `import`, or `clear`
- `content`: required for `replace` and `append`
- `source_path`: required for `import`; agent-driven imports are restricted to the current workspace
- `explicit_intent`: must be `true` for `replace`, `append`, `import`, or `clear`

## Safety

Use a mutating action only when the user explicitly asks to persist an instruction change. Mentioning a preference or an `@path` alone is not authorization. The tool writes only the canonical user-instructions file and does not require allow-all mode.

The mutating agent actions are available only in AGENT. The `/instructions` command remains available directly from the TUI, where persistent changes also require AGENT.
