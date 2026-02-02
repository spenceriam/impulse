# file_edit

Performs exact string replacements in files.

## Parameters

- filePath (required): Absolute path to the file
- oldString (required): Exact text to replace
- newString (required): Replacement text
- replaceAll (optional): Replace all matches (default false)

## Usage

- Read the file first
- Preserve indentation and whitespace
- Use replaceAll for renames across a file

## Error Conditions

- The edit fails if oldString is not found
- The edit fails if oldString is found multiple times unless replaceAll is true
- Provide more context in oldString to make it unique if needed
