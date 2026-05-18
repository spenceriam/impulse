# Plan: Session Picker Overlay + Model Selector Overlay

## Branch
`feat/session-picker-model-overlay`

## Goal
Restore the ability to browse and continue saved sessions via a searchable overlay, and move model switching out of the prompt box into a dedicated searchable overlay — reusing the visual pattern (not the component) of the existing QuestionOverlay.

---

## Part 1: Session Title Generation

### Problem
`headerTitle` exists on the `Session` interface but is never populated. Sessions auto-save with generic date names like "Session May 18, 14:30".

### Approach
After the first assistant message in the agent loop, trigger AI-driven title generation.

### Changes

#### A. Title generation prompt (new file)
**`src/session/title-generator.ts`**
- Export `generateTitle(messages: Message[], provider: string, model: string): Promise<string>`
- Sends the first few user-assistant exchanges to the LLM with a short system prompt: "Generate a concise session title (max 50 chars) based on this conversation. Return ONLY the title, no quotes or explanation."
- Uses the provider client that's already configured (reuse from agent loop)
- Returns the title string

#### B. Wire into agent loop
**`src/agent/loop.ts`** (or wherever the response is processed after tool execution)
- After the first assistant message is persisted (when `session.messages` has at least 2 user messages + 1-2 assistant responses), check if `session.headerTitle` is undefined
- If so, call `generateTitle()` and then `SessionManager.update({ headerTitle: title })`
- Publish `HeaderEvents.Updated` so the renderer can update the header line

#### C. Renderer header display
**`src/cli/renderer.ts`**
- Subscribe to `HeaderEvents.Updated` (currently no subscriber exists)
- When fired, update the header line to `[IMPULSE] | <title>` (replacing the static "New session" or date-based header)
- This header already exists in the layout as the first line of the chat container

---

## Part 2: Session Picker Overlay

### Problem
`/continue` without an ID prints a text list. The command isn't even wired into the renderer's `handleSlash` — it falls through to "Unknown command".

### Approach
Build a dedicated `SessionPickerOverlay` component. When the user types `/continue` (with no args), show this overlay. `/new` already works (saves current session, starts fresh). `/save` and `/load` are unnecessary — sessions auto-save on every message, and `/continue` is the only trigger needed to browse/restore. Keep the existing behavior where `/continue <sessionID>` loads directly without the picker.

### Changes

#### A. SessionPickerOverlay component (new file)
**`src/cli/components/session-picker-overlay.ts`**
- Implement `Component` interface from `@mariozechner/pi-tui`
- **Appearance:** Dark background box (`#233`), `┌─ Continue session ──┐` border, same visual pattern as QuestionOverlay
- **Dimension:** `maxHeight: 18`, `width: "92%"`, similar to question overlay
- **Layout:**
  ```
  ┌─ Continue session ────────────────────────────────────────┐
  │                                                            │
  │  Search: _                                                │
  │                                                            │
  │  > Implement API client — ollama/deepseek  · 2h ago       │
  │    Fix auth middleware — openrouter/claude  · yesterday    │
  │    Refactor tool registry — ollama/llama3.2  · 3 days ago │
  │                                                            │
  │  ↑↓ navigate  Enter continue  Esc cancel                  │
  └────────────────────────────────────────────────────────────┘
  ```
- **Selection:** Arrow keys navigate, Enter loads session, Esc cancels
- **Filtering:** Captures keystrokes when not arrow/enter/esc, appends to search string, live-filters the list by title substring match (case-insensitive)
- **Session info per row:** Title (or date name fallback), model, relative time ("2h ago", "yesterday")
- **Callbacks:** `onSelect(sessionID)` and `onCancel()`

#### B. Wire `/continue` into renderer
**`src/cli/renderer.ts`** — `handleSlash` method
- Add `case "continue":` to the switch
- Without args: call `SessionManager.listSessions()`, show `SessionPickerOverlay`
  - On select: call `SessionManager.load(sessionID)`, clear chat, reload messages
  - On cancel: dismiss overlay, no-op
- With args (session ID): call `SessionManager.load(id)` directly (quick-restore shortcut)

Note: `/save` and `/load` are not added — sessions auto-save on every message, and `/continue` is the only surface needed. `/new` already works (saves current + starts fresh).

---

## Part 3: Save Timing & Ctrl+C Safety

### Problem
Currently `addMessage()` immediately calls `this.update()` (which writes to disk) on every single message — including each tool call result within a turn. This means a single turn produces 3-5 disk writes. Sessions are always persisted mid-turn. Additionally, `Ctrl+C` while idle exits without explicitly flushing the session.

### Approach

#### A. Consolidate saves to per-turn
**`src/session/manager.ts`** — `addMessage()` method
- Replace immediate `this.update({ messages })` with `SessionStoreInstance.autoSave(sessionID, { messages })`
- `autoSave` already exists in the store with a 1-second debounce — it batches rapid updates
- This means within a turn, the session is written once after the final message lands (or at most once per second)

#### B. Flush on turn completion
**`src/agent/loop.ts`**
- After the main loop exits (`continueLoop = false`), call `SessionStoreInstance.flushSave(sessionID)` if a timeout is pending
- This ensures the session is on disk at the end of every completed turn
- When the session picker lists sessions, they'll always show the conversation through the last completed AI response

#### C. Save on exit paths
**`src/cli/renderer.ts`** — `showExitStats()` and `onAbort`
- Before `process.exit(0)`, call `SessionManager.save()` to flush any pending changes + headerTitle
- This covers `/quit`, `/exit`, `Ctrl+C` while idle, and `Ctrl+D` (EOF)
- Also flush on `/new` before creating the new session (already handled — `createNew` calls `exitCurrent` which runs cleanup but doesn't save; should add a save call)

#### D. Store changes
**`src/session/store.ts`**
- Add `flushSave(sessionID: string): Promise<void>` — clears the debounce timeout and immediately calls `update`
- Add `flushAllSaves(): Promise<void>` — flushes all pending save timeouts
- Both are used by exit paths to ensure no data loss

---

## Part 4: Model Selector Overlay

### Problem
Model switching is an inline multi-step wizard that uses the prompt input box. The model name appears inline in the layout. The user wants it moved to an overlay with live search filtering.

### Approach
Build a dedicated `ModelPickerOverlay` component. When the user types `/model`, show this overlay. Remove the inline model setup text from between the separator and prompt.

### Changes

#### A. ModelPickerOverlay component (new file)
**`src/cli/components/model-picker-overlay.ts`**
- Implement `Component` interface from `@mariozechner/pi-tui`
- **Appearance:** Same dark box style, `┌─ Switch model ──┐` border
- **Dimension:** `maxHeight: 18`, `width: "92%"` — same as question overlay
- **Layout (single provider — flat list):**
  ```
  ┌─ Switch model — ollama/deepseek-v4-pro ────────────────────────┐
  │  [add provider]                                                │
  │  Search: _                                                    │
  │                                                                │
  │  > deepseek-v4-pro                                            │
  │    deepseek-v4-flash                                          │
  │    llama3.2-vision                                            │
  │    qwen3-coder                                                │
  │  …                                                            │
  │                                                                │
  │  ↑↓ navigate  Enter select  Tab add provider  Esc cancel      │
  └────────────────────────────────────────────────────────────────┘
  ```
- **Layout (multiple providers — flat list grouped by provider):**
  ```
  ┌─ Switch model — ollama/deepseek-v4-pro ────────────────────────┐
  │  [add provider]                                                 │
  │  Search: glm_                                                   │
  │                                                                 │
  │  ── openrouter ──                                               │
  │  > glm-4.7                                                      │
  │    glm-4.7-flash                                                │
  │    glm-4.6                                                      │
  │  ── ollama ──                                                   │
  │    (no matches)                                                 │
  │                                                                 │
  │  ↑↓ navigate  Enter select  Tab add provider  Esc cancel       │
  └─────────────────────────────────────────────────────────────────┘
  ```

- **Provider display rules:**
  - Single configured provider: flat list, no section headers, provider name in header
  - Multiple providers: all models shown grouped by provider with section headers (flat within each group)
  - Search filters across ALL providers simultaneously
  - Tab key: opens "add provider" flow (reuses existing provider setup)
  - The model list auto-scrolls with arrow key navigation

- **Data loading:**
  - On open, loads cached model list for each configured provider
  - If no cached list exists for a provider, calls `discoverModels()` with a spinner
  - Uses the existing `discoverModels()` and `testOllamaConnection()` from `model-setup.ts`

- **Live filtering:** Captures keystrokes, appends to search string, filters model names by case-insensitive substring match
- **Selection:** Arrow keys navigate, Enter selects model, Esc cancels
- **On select:** Calls existing model-switch logic to update the session model
- **Callbacks:** `onSelect(providerKey, modelName)` and `onCancel()`

#### B. Refactor model setup flow
**`src/cli/renderer.ts`** 
- The `cmdModel()` method currently runs the full inline wizard
- Refactor: `cmdModel()` → show `ModelPickerOverlay`
- Remove `modelSetupText` from the layout (the text element between separator and prompt)
- Remove `modelSetup` state, `renderModelSetup()`, `setupModelNavigation()`, `selectModelSetupProvider()`, `handleModelSetupSubmit()`, `cancelModelSetup()`, `modelSetupPrompt()` — replace with overlay-based flow
- Keep: `discoverModels()`, provider config saving, `saveHomeEnv()`, `resetProviderManager()` — these are called by the overlay handler

#### C. Model cache (update model-setup.ts)
**`src/cli/model-setup.ts`** 
- Add `cachedModelLists: Map<string, string[]>` — keyed by provider key
- `getCachedModels(providerKey: string): string[] | undefined`
- `setCachedModels(providerKey: string, models: string[]): void`
- Called by `discoverModels()` to populate, checked by `ModelPickerOverlay` on open

#### D. Wire `/model` and remove inline model display
**`src/cli/renderer.ts`** — `handleSlash` method
- `case "model":` → show `ModelPickerOverlay` (no args needed — overlay handles everything)
- Remove `modelSetupText` Text component from layout (the element between separator and prompt)
- Remove `finishModelSetup()` and inlined model setup state/functions
- Keep context bar model display (shows current model after selection)

---

## Part 5: Shared Patterns

Both new components follow the existing overlay pattern in the codebase:

### Component interface
```ts
export class XxxOverlay implements Component {
  onSelect?: (...) => void;
  onCancel?: () => void;
  
  constructor(/* data */);
  
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
}
```

### Overlay display (in renderer)
```ts
const overlay = new XxxOverlay(data);
overlay.onSelect = (result) => {
  this.xxxOverlayHandle?.hide();
  this.xxxOverlayHandle = null;
  // handle result
};
overlay.onCancel = () => {
  this.xxxOverlayHandle?.hide();
  this.xxxOverlayHandle = null;
};

this.xxxOverlayHandle = this.tui.showOverlay(overlay, {
  anchor: "bottom-center",
  offsetY: -4,
  width: "92%",
  minWidth: 70,
  maxHeight: 18,
  margin: { left: 2, right: 2, bottom: 4 },
});
this.xxxOverlayHandle.focus();
```

### ANSI styling
Reuse color constants from QuestionOverlay: `#233` background, blue highlight for selection, dim text for context, bold for headers.

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/session/title-generator.ts` | **Create** | AI-driven session title generation |
| `src/session/store.ts` | **Edit** | Consolidate saves per-turn via `autoSave` debounce; add `flushSave()` for exit paths |
| `src/agent/loop.ts` | **Edit** | Trigger title generation after first response; flush save on turn completion |
| `src/cli/components/session-picker-overlay.ts` | **Create** | Overlay for browsing/continuing sessions |
| `src/cli/components/model-picker-overlay.ts` | **Create** | Overlay for searching/selecting models |
| `src/bus/events.ts` | **Verify** | `HeaderEvents.Updated` exists — just needs subscriber |
| `src/cli/renderer.ts` | **Edit** | Wire `/continue` + `/model` → overlays; remove inline model setup; subscribe to header updates; save on exit/Ctrl+C; add overlay handles |
| `src/cli/model-setup.ts` | **Edit** | Add model list caching for fast overlay open |
| `src/session/manager.ts` | **Edit** | Add `setHeaderTitle()`; use `autoSave` in `addMessage` instead of immediate `update` |
| `src/session/store.ts` | **Verify** | `headerTitle` field already exists on `Session` interface |

---

## Verification

1. **Title generation:** Start a new session, send 2-3 prompts. Check that the session gets an AI-generated title (visible in the header line and in the session store JSON).
2. **Session picker:** Type `/continue`. Verify the overlay shows past sessions with titles, arrow keys navigate, typing filters by title, Enter loads the session, Esc cancels.
3. **Session restore:** After loading a session via the picker, verify all messages appear in the chat.
4. **Model selector — single provider:** With one provider configured, type `/model`. Verify a flat list of models appears, typing filters live, Enter selects, Esc cancels.
5. **Model selector — multiple providers:** With 2+ providers configured, type `/model`. Verify models are grouped by provider with section headers, search filters across all providers.
6. **Save timing:** Sessions persist once per turn (not per message). The session picker shows conversations through the last completed AI response.
7. **Ctrl+C safety:** Exiting with `Ctrl+C`, `/quit`, or `/exit` flushes pending saves — no data loss.
8. **No regressions:** The prompt input box should ONLY be for typing messages — no model name or setup text appears there. The inline model setup text between separator and prompt should be gone.
9. **Branch:** Create `feat/session-picker-model-overlay` before starting implementation.
