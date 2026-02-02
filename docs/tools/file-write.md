# file_write

Writes a file to the local filesystem (creates or overwrites).

## Parameters

- filePath (required): Absolute path to the file
- content (required): Full file contents to write

## Usage

- Overwrites existing files
- Always read an existing file before overwriting
- Prefer file_edit for small changes
- Do not create documentation files unless explicitly requested

## Notes

- Creates parent directories if missing
- Preserves file permissions when overwriting
