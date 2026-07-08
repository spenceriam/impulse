# ls

List directory contents.

## Parameters

- path (optional): Directory to list (defaults to the current working directory)
- limit (optional): Maximum number of entries to return (default and hard cap: 500)

## Usage

- Use to see what's in a directory before deciding which file to read
- Entries are sorted alphabetically (case-insensitive); directories get a trailing `/`
- Dotfiles are included
- Use `glob` instead when you need recursive file discovery by pattern (e.g. `**/*.ts`)
- Use `file_read` to read a specific file's contents — passing a directory to `file_read` fails with a corrective listing

## Notes

- If `path` is omitted, the current working directory is listed; the tool result includes a `Note:` explaining that default.
- Output is capped at 500 entries or ~64KB, whichever is hit first; truncated results say `(showing first X of N entries)`.
- If `path` points to a file, the call fails with a message suggesting `file_read` instead.
