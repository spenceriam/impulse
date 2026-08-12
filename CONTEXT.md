# Impulse domain language

## Modes

### ASK

The default mode for understanding, explaining, planning, and diagnosing without changing the user's project. When a request needs execution, ASK presents an explicit path forward instead of silently gaining authority.

### AGENT

The mode for carrying out user-authorized work that may change the project or run consequential commands. Entering AGENT is an explicit user choice.

### Mode transition

An explicit change between ASK and AGENT. A request made in ASK may prompt a mode transition, but cannot cause one implicitly.

### Explicit user transition

A mode transition initiated directly by the user through an authority control. It is distinct from a model request, startup default, or session resume; only an explicit user transition may increase authority from ASK to AGENT.

## Execution safety

### Approval policy

The rule governing when Impulse asks the user before an action. Approval policy describes consent, not the technical boundary on what a process can access.

### Execution boundary

The enforced limit on files, network access, processes, and other system capabilities available during execution. An execution boundary remains meaningful even when individual actions do not require approval.
