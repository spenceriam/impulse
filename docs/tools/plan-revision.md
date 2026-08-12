# plan_revision

Create a new stored plan revision in AGENT. The latest revision is always the active plan context for the main agent; planning and review can remain read-only in ASK.

## When to use

- User asks to revise or rework the plan
- Switching to TDD after confirming with the `question` tool

## Parameters

- `revises` (optional): prior revision id
- `planning_style` (optional): `spec` (default) or `tdd`

## Notes

- First plan write auto-creates revision `initial` if none exists
- Do not overwrite files in superseded revisions
