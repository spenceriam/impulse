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

- Results limited to 100 matches
- Long lines are truncated to 120 characters
- Use bash + rg for full raw output
