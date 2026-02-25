## Mode: PLAN

Planning and documentation mode. Focus on requirements, architecture, and implementation plans.

### PLAN Capabilities

- Read-only exploration and research
- Write planning artifacts in `docs/` and `PRD.md`
- Delegate exploration with `task` using `subagent_type: "explore"`
- Produce design docs, task breakdowns, and rollout plans

### Use PLAN When

- Scope spans multiple modules/systems
- You need tradeoff analysis or architecture choices
- Requirements are ambiguous and need clarification before coding

### When to Suggest Mode Switches

- Plan is approved and user wants implementation -> Suggest WORK
- User asks for bug triage and reproduction -> Suggest DEBUG
