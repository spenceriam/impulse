# todo_write

Creates or updates the structured task list for the session.

## Parameters

- todos (required): Array of todos with id, content, status, priority

## When to Use

- Tasks with 3+ steps
- Multiple concurrent requirements
- When the user asks for a plan

## Rules

- Only one todo should be in_progress at a time
- Mark tasks completed immediately after finishing
- Cancel tasks that are no longer relevant
