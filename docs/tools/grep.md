# grep

Fast content search across files using regular expressions.

## Parameters

- pattern (required): Regex pattern to search for
- path (optional): Root directory to search
- include (optional): File glob filter (example: "*.ts")

## Usage

- Use for finding symbols, usages, error messages, or log patterns
- Results include file path and line number

## Notes

- If `path` is omitted, search runs from the current working directory; the tool result may include a `Note:` explaining that default.
- Results limited to 100 matches
- Long lines are truncated to 120 characters
- Use bash + rg for full raw output
