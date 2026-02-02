# file_read

Reads a file from the local filesystem.

## Parameters

- filePath (required): Absolute path to the file
- offset (optional): Line offset to start from (0-based)
- limit (optional): Number of lines to read (default 2000)

## Usage

- Reads up to 2000 lines by default
- Long lines (>2000 chars) are truncated
- Output includes line numbers starting at 1
- You can read multiple files in parallel by making multiple calls

## Notes

- If the file exists but is empty, a warning is returned
- This tool can read image files as raw content
