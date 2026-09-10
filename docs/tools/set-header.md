# set_header

Sets the session header title shown as "[impulse] | <title>".

## Parameters

- title (required): Specific description of the conversation, 2-5 words, max 40 characters

## Usage

- Set once the conversation's purpose is clear
- Update only on meaningful milestones
- Name the subject: the file, feature, or problem (e.g. "Heartbeat reconnect loop")
- Do NOT use generic labels ("Code help", "Question", "Discussion"), answer echoes, or numbers only

## Rules

The tool and the automatic title generator share one policy:

- **Hard cap:** 40 characters
- **Word band:** 2-5 words. One-word labels and sentence-length titles are rejected.
- **Specificity:** generic labels are rejected — a short but vague title fails the same way a long one does.
- **Uniqueness:** titles must be unique per project. A collision is disambiguated deterministically with a ` (2)`, ` (3)` suffix, so `/resume` entries stay distinguishable. The tool reports when this happened.
- **Ownership:** a title set through this tool is marked manual and is never replaced by the automatic generator.
