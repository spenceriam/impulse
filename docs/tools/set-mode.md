# set_mode

Switches between the two operating modes: ASK and AGENT.

## Parameters

- mode (required): ASK or AGENT
- reason (optional): Short reason shown to the user

## Usage

- The model may de-escalate AGENT to ASK.
- ASK to AGENT requires direct user authority. For consequential work, use `execution_handoff` so the user can choose Preview safely, Switch to AGENT, or Stay in ASK.
- Never infer, replay, or synthesize an elevation choice.
