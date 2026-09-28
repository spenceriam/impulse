# task

Launches a subagent for autonomous task execution.

## Parameters

- prompt (required): The subagent's task prompt
- description (required): Short description of the task
- subagent_type (required): explore | general
- thoroughness (optional, explore only): quick | medium | thorough

## Subagent Types

explore (read-only, fast)
- Tools: file_read, glob, grep, ls, web_search, web_fetch
- Use for: locating code, understanding patterns, external research, answering "where/what/how" questions

general (full access)
- Tools: file_read, file_write, file_edit, glob, grep, ls, bash
- Use for: multi-step refactors, implementations, test runs

## Parallel execution

- Multiple `task` tool calls in the **same model turn** run **in parallel**.
- The main agent waits until **all** tasks in that batch finish before receiving tool results.
- Up to **8** sub-agents run concurrently; additional tasks are **queued** and start as slots free up.
- Each task gets its own in-chat tool row; progress lines are routed by tool call id.
- Completed task rows **collapse** to a one-line summary (description + duration).
- Progress under each task shows interleaved **thinking...** and **tool** actions; **wrapping up...** appears once when the sub-agent finishes after tool work (not between every tool round).

## Batch permission (general only)

When a turn includes **more than 8** `general` tasks, Impulse shows **one** approval dialog with the exact count:

- **Approve** — run all general tasks (8 concurrent max, queue the rest)
- **Deny** — fail all `general` tasks in that batch (explore tasks still run)
- **Other** — alternate choices: queue with 8 cap, run only the first 8, or cancel the batch

Batches of **8 or fewer** `general` tasks run immediately with no dialog. `explore` tasks are never gated by this dialog.

Sub-agents in a batch start with a **1.5s offset per task index** (first task immediate, second after 1.5s, etc.) to reduce simultaneous load on the inference endpoint. Elapsed time on each task row starts when that sub-agent actually begins work (not when the row first appears).

## Notes

- `thoroughness` only affects `explore` subagents. If you pass it with `general`, it is ignored and the result may include a `Note:`.

## When to Use

- Searching across the codebase
- Multi-file exploration or analysis
- Independent work that can be parallelized

## When Not to Use

- Reading a single known file (use file_read)
- Simple single-file edits (do it directly)
- Information already in context

## Notes

- Subagent results return to the main agent, not the user
- Provide specific prompts; subagents do not see conversation history
- Mode restrictions:
  - PLAN: only `subagent_type: "explore"` is allowed
  - WORK/DEBUG: both `explore` and `general` are allowed
