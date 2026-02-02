# task

Launches a subagent for autonomous task execution.

## Parameters

- prompt (required): The subagent's task prompt
- description (required): Short description of the task
- subagent_type (required): explore | general
- thoroughness (optional, explore only): quick | medium | thorough

## Subagent Types

explore (read-only, fast)
- Tools: file_read, glob, grep
- Use for: locating code, understanding patterns, answering "where/what/how" questions

general (full access)
- Tools: file_read, file_write, file_edit, glob, grep, bash
- Use for: multi-step refactors, implementations, test runs

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
