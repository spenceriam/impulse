# Tool Input Repair Layer

The tool input repair layer improves tool-calling reliability for open and local models by fixing common structured-output mistakes in the harness, rather than expecting perfect JSON from the model.

Design reference: [validate-then-repair technique](https://x.com/MrAhmadAwais/status/2050956678502420612)

## Design Principle: Validate-Then-Repair

1. Validate raw tool arguments against the tool's Zod schema.
2. If valid, pass through **unchanged** (no preprocessing, no mutation).
3. If invalid, apply targeted repairs in a fixed order.
4. Re-validate after each repair pass; stop on first success.
5. Log successful repairs for observability.
6. On final failure, return a clean, human- and model-readable error (never raw `ZodError` objects).

Implementation: [`src/tools/input-repair/`](../src/tools/input-repair/)

Integration point: [`Tool.execute`](../src/tools/registry.ts)

## Pipeline

```
Model JSON → Tool.execute → safeParse(raw)
  ├─ success → handler (unchanged input)
  └─ failure → clone → ordered repairs → safeParse(repaired)
       ├─ success → log repairs → handler
       └─ failure → formatted error
```

## Ordered Repairs

| Order | Name | Fixes |
|------:|------|-------|
| 1 | `nullForOptional` | `null` on optional fields → omit key |
| 2 | `stringifiedArray` | `"[\"a\",\"b\"]"` → real array |
| 3 | `objectToArray` | `{}` → `[]`; single-key wrapper → inner array |
| 4 | `stringToArray` | bare string → `[string]` when array expected |
| 5 | `markdownPathUnwrap` | `/path/[file.md](http://file.md)` → `/path/file.md` |

Each repair lives in [`src/tools/input-repair/repairs/`](../src/tools/input-repair/repairs/) and is independently testable.

## Relational Invariants (Tool-Level)

Some parameters only make sense together (e.g. `offset` + `limit` on `file_read`). The repair layer does **not** invent missing companions.

Handle these inside tool handlers with sensible defaults and a transparent `Note:` in the tool result:

```
Note: limit was not provided, so it defaulted to 2000 lines. You can retry with both offset and limit if you need a different range.
```

Helpers live in [`src/tools/tool-notes.ts`](../src/tools/tool-notes.ts). Use `prependToolNote(output, note)` in handlers.

| Tool | Note when |
|------|-----------|
| `file_read` | Only `offset` or only `limit` provided (defaults for the missing param) |
| `glob`, `grep` | `path` omitted (search runs from cwd) |
| `web_fetch` | `maxChars` and/or `browserFallback` omitted |
| `web_search` | `maxResults` and/or `browserFallback` omitted |
| `task` | `thoroughness` set while `subagent_type` is `general` (ignored) |

Reference: `buildFileReadRangeNote` in `file_read` (re-exported from `tool-notes.ts`).

## Branded Schema Types

Generic `z.string()` encourages model confusion. Prefer branded helpers from [`src/tools/schemas/branded.ts`](../src/tools/schemas/branded.ts):

| Helper | Use for |
|--------|---------|
| `zFilePath()` | File/directory paths (plain text, no Markdown) |
| `zCommandString()` | Shell commands |
| `zGlobPattern()` | Glob patterns like `**/*.ts` |
| `zCodeEdit()` | Exact search/replace snippets |

**Before:**

```typescript
const ReadSchema = z.object({
  filePath: z.string(),
});
```

**After:**

```typescript
import { zFilePath } from "./schemas/branded";

const ReadSchema = z.object({
  filePath: zFilePath(),
});
```

Used on: `file_read`, `bash`, `file_edit`, `file_write`, `glob`, `grep` (`path`, `include`; regex `pattern` stays `z.string()`).

## Observability

When repairs succeed:

- **Info log** (`~/.config/impulse/logs/impulse.log`): `tool_input_repair: file_read [nullForOptional@offset]`
- **Debug JSONL** (with `--verbose`): `{ "type": "tool_input_repair", "tool": "...", "repairs": [...] }`

Valid inputs produce no repair logs.

## Adding a New Repair

1. Create `src/tools/input-repair/repairs/my-repair.ts`:

```typescript
import type { RepairEvent, RepairContext } from "../types";

export function repairMyCase(ctx: RepairContext): RepairEvent[] {
  const events: RepairEvent[] = [];
  // Inspect ctx.issues, mutate ctx.input clone, push events
  return events;
}
```

2. Register it in the ordered `REPAIR_PIPELINE` array in [`src/tools/input-repair/index.ts`](../src/tools/input-repair/index.ts).

3. Add tests in [`test/tool-input-repair.test.ts`](../test/tool-input-repair.test.ts).

Keep repairs conservative: if ambiguous, fail with a clean error rather than guessing.

## Tests

```bash
bun test test/tool-input-repair.test.ts test/tool-notes.test.ts
```

Covers passthrough safety, each repair, branded-schema integration, relational `Note:` output, and per-tool note builders.
