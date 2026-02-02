# bash

Executes a shell command in a persistent session.

## Parameters

- command (required): Shell command to execute
- description (required): Short human description (5-10 words)
- workdir (optional): Working directory for the command
- timeout (optional): Timeout in milliseconds (default 120000)
- interactive (optional): Enable interactive PTY mode

## Usage

- Commands run in the project working directory by default
- Prefer workdir instead of "cd <dir> && <command>"
- Use interactive=true for commands that need input (sudo, vim, etc.)
- Output exceeding 2000 lines will be truncated

## Safety and Best Practices

- Avoid using bash for file operations; use tools instead:
  - File search: glob (not find/ls)
  - Content search: grep (not grep/rg)
  - Read files: file_read (not cat/head/tail)
  - Edit files: file_edit (not sed/awk)
  - Write files: file_write (not echo)

## Git Safety

- Never update git config
- Never run destructive git commands (push --force, reset --hard) without explicit user request
- Never skip hooks (--no-verify) unless explicitly requested
- Never commit changes unless explicitly asked

## Interactive Mode

Examples that usually require interactive=true:
- sudo, vim, nano, git rebase -i, npm init
- ssh, mysql, psql

The user can press Ctrl+F to focus the terminal and type input.
