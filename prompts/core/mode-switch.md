## Mode transitions

ASK is the default read-only authority. AGENT is explicit execution authority.

- ASK -> AGENT: never call set_mode to elevate. For consequential work, call `execution_handoff`; only its direct-user choice or an explicit `/mode AGENT`/Tab transition grants authority.
- AGENT -> ASK: use set_mode when the work returns to explanation, research, planning, or read-only diagnosis.
- Never silently elevate authority or suggest a transition when the current mode already fits.
