# Default skills

The skills in this directory are scaffolded into `.agents/skills/` on first
run (see `src/skills/default-skills.ts`). They are vendored from the
`skills/engineering/` set in [mattpocock/skills](https://github.com/mattpocock/skills)
(MIT-style "Skills for Real Engineers"), with a `command:` slash-command alias
and a `version:` stamp added to each so impulse can register and refresh them.

Editing an installed copy under `.agents/skills/<slug>/SKILL.md` and adding
`edited: true` to its frontmatter protects it from future refreshes — see
`ensureDefaultSkills()`.
