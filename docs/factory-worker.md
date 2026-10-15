# Impulse Factory worker

`impulse-worker` is the unattended counterpart to the interactive `impulse` CLI. It implements the `impulse-factory-worker/v1` protocol used by [`spenceriam/impulse-factory`](https://github.com/spenceriam/impulse-factory).

## Protocol probe

```bash
impulse-worker --factory-protocol
```

Output:

```text
impulse-factory-worker/v1
```

## Run a stage

The factory orchestrator invokes:

```bash
impulse-worker \
  --factory-protocol impulse-factory-worker/v1 \
  --job /absolute/path/to/job.json \
  --prompt /absolute/path/to/prompt.md \
  [--timeout-ms 1800000]
```

The worker:

1. Validates the job and keeps the result path inside the assigned stage directory.
2. Creates an isolated per-run Impulse HOME.
3. Prevents default skills from dirtying the target checkout.
4. Changes into the assigned repository worktree.
5. Loads tools and runs the real `AgentLoop` without the interactive renderer.
6. Emits JSON Lines lifecycle events to stdout.
7. Rejects permission requests, questions, plan approvals, batch approvals, and loop check-ins as durable blockers unless explicit sandboxed allow-all policy was supplied.
8. Writes a validated `impulse-factory-result/v1` object to the required result path.
9. Exits `0` for completed, `2` for blocked, and `1` for failed.

Provider secrets remain in process environment references and are never copied to the isolated config, logs, events, or result artifact.

## Build

The normal build creates both entry points:

```bash
bun run build
```

Outputs:

- `dist/index.js` — interactive `impulse`
- `dist/worker.js` — unattended `impulse-worker`

Platform release binaries build both executables.
