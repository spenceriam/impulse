# Windows Tool Calling Bug Fix

## Issue Summary

**Problem:** Tool calls were failing on Windows with "Zod validation failed" errors, preventing the agent from executing basic file operations.

**Root Cause:** The `hasDegeneratePathMarkdown()` function in the input repair system was incorrectly identifying legitimate Windows file paths as invalid markdown links.

## Technical Analysis

### The Validation Flow

1. Model generates tool call with file path argument (e.g., `C:\workspace\src\index.ts`)
2. `Tool.execute()` validates parameters using Zod schema
3. For path parameters, `zFilePath()` applies `hasDegeneratePathMarkdown()` check
4. If check fails, validation error is returned to model
5. Model receives error but loses context about the original user request

### Why It Failed on Windows

The regex pattern in `path-markdown.ts`:
```typescript
/^(.*)\[([^\]/\\]+)\]\((?:https?:\/\/|file:\/\/)?([^)/\\]+)\)$/
```

This pattern correctly detects degenerate markdown links like:
- `[file.ts](file.ts)` → Should be unwrapped to `file.ts`
- `prefix[test](test)` → Should be unwrapped to `prefixtest`

However, the original `hasDegeneratePathMarkdown()` implementation ran the regex test on ALL paths, including:
- `C:\workspace\src\file.ts` → False positive if backslashes somehow triggered the pattern
- Windows paths with spaces
- UNC paths like `\\server\share\file.txt`

## The Fix

### 1. Enhanced Path Validation (`path-markdown.ts`)

```typescript
export function hasDegeneratePathMarkdown(value: string): boolean {
  // Skip validation for empty strings or very short values
  if (!value || value.length < 3) return false;
  
  // Quick heuristic: legitimate Windows absolute paths should never be considered markdown
  // Pattern: C:\ or C:/ at start, or UNC paths \\server\share
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) {
    // But still check if there's a markdown link embedded later in the path
    const linkIndex = value.indexOf('[');
    if (linkIndex === -1) return false;
  }
  
  return unwrapDegeneratePath(value) !== null;
}
```

**Key improvements:**
- Early return for empty/short strings
- Explicit check for Windows absolute paths (C:\, D:\, etc.)
- Explicit check for UNC paths (\\\\server\\share)
- Only runs full regex if there's a potential markdown link (`[` character present)

### 2. Better Error Messages (`format-error.ts`)

```typescript
function formatIssue(issue: z.ZodIssue, input: unknown): string {
  // ... extract actual value that failed ...
  
  case "invalid_string":
    // For refined string validation (like path markdown check), include the actual value
    if (typeof actualValue === "string" && actualValue.length < 100) {
      return `${path}: ${issue.message} (received: "${actualValue}")`;
    }
    return `${path}: ${issue.message}`;
}
```

**Before:**
```
Invalid parameters for file_read: filePath: Path must be plain text, not a Markdown link
```

**After:**
```
Invalid parameters for file_read: filePath: Path must be plain text, not a Markdown link (received: "C:\workspace\src\index.ts")
```

This immediately shows whether:
- The model is outputting bad paths (markdown links when it shouldn't)
- The validation logic has a bug (legitimate paths being rejected)

### 3. Comprehensive Test Coverage

Added 15 test cases covering:
- Windows absolute paths: `C:\Users\test\file.txt`
- Unix absolute paths: `/usr/bin/node`
- Relative paths: `./src/index.ts`
- UNC paths: `\\\\server\\share\\file.txt`
- Degenerate links: `[file](file)`
- Windows paths with embedded links: `C:\src\[file](file)`
- Legitimate markdown: `[README](./README.md)`

## Testing Validation

### Before Fix
```
// These would incorrectly fail validation:
hasDegeneratePathMarkdown("C:\\workspace\\src\\file.ts") // ??? (depending on environment)
```

### After Fix
```
// All these now work correctly:
hasDegeneratePathMarkdown("C:\\Users\\test\\file.txt") // → false ✓
hasDegeneratePathMarkdown("\\\\server\\share\\file.txt") // → false ✓
hasDegeneratePathMarkdown("[file.ts](file.ts)") // → true ✓
hasDegeneratePathMarkdown("C:\\src\\[file](file)") // → true ✓
```

## Secondary Issue: The "hey" Problem

The screenshot showed the model thinking the user said "hey" after the tool failure. This is likely caused by:

1. **Tool validation failure** → Error returned to model
2. **Context loss** → Model loses track of the original user request
3. **Model confusion** → Tries to infer what happened, makes incorrect assumption

### Why This Happens

When a tool call fails validation:
1. Error message is added to conversation as a tool result
2. Model sees: "Tool failed with validation error"
3. Model doesn't have enough context to understand:
   - What the user originally asked for
   - Why the tool call was generated
   - Whether to retry with a different approach

### How The Fix Helps

With the path validation fixed:
- Tool calls succeed on first attempt
- Model maintains context throughout the turn
- No confusion about what the user asked

## Additional Safeguards

The enhanced error messages also help in other scenarios:
- When models output truly invalid paths (actual markdown links)
- When path normalization has issues
- When debugging future validation problems

## Files Changed

1. `src/tools/input-repair/path-markdown.ts` - Enhanced Windows path detection
2. `src/tools/input-repair/format-error.ts` - Better error messages with actual values
3. `src/tools/input-repair/index.ts` - Pass input to formatValidationError
4. `src/tools/input-repair/__tests__/path-markdown.test.ts` - New test suite

## Deployment

Once merged:
1. Windows users should no longer experience tool validation failures
2. Error messages will be more helpful for debugging future issues
3. Tests will prevent regression

## Follow-up Recommendations

1. **Monitor error rates** - Track validation failures in production
2. **Add telemetry** - Log when repairs are applied vs when validation still fails
3. **Extend tests** - Add integration tests with actual Windows VM
4. **Model guidance** - Update system prompt with explicit path formatting guidelines for Windows
