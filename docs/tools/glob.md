# glob

Fast file pattern matching for large codebases.

## Parameters

- pattern (required): Glob pattern (example: "**/*.ts")
- path (optional): Root directory to search

## Usage

- Use for file discovery by name or extension
- Do not use for searching file contents (use grep)

## Notes

- Results are limited to 1000 files for efficiency
- Files are returned in filesystem order
