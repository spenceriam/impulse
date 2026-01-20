# Tasks

> Implementation tasks for glm-cli using BMAD-method

Generated: 01-19-2026
Updated: 01-20-2026 (Phase 8 added - Integration Wiring discovered during testing)

---

## Overview

8 phases, sequential execution (with Phases 3-4 parallelizable). Each task includes prerequisites, before/after states, steps, and verification.

| Phase | Name | Tasks | Est. Effort |
|-------|------|-------|-------------|
| 1 | Foundation | 11 | Large |
| 2 | Core UI + Modes | 15 | Large |
| 3 | MCP Integration | 6 | Medium |
| 4 | Multi-Modal Input | 5 | Medium |
| 5 | Agent & Tools | 14 | Large |
| 6 | Session Management | 8 | Medium |
| 7 | Polish + Release | 6 | Medium |
| 8 | Integration Wiring | 5 | Medium |

**Note:** Phase 8 was discovered during testing. Phases 1-7 built infrastructure in silos; Phase 8 wires everything together in App.tsx.

### Critical Configuration Requirements

Before starting Phase 2, ensure these configurations are correct:

**tsconfig.json** must include:
```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

**bunfig.toml** must include:
```toml
preload = ["@opentui/solid/preload"]
```

**package.json** dependencies:
```json
{
  "@opentui/core": "^0.1.74",
  "@opentui/solid": "^0.1.74",
  "solid-js": "^1.9.0"
}
```

---

## Phase 1: Foundation

> Project setup, configuration, storage, event bus, and base infrastructure

---

### Task 1.1: Initialize Project

**Prerequisites:** None
**Dependencies:** Bun 1.0+
**Estimated Effort:** Small
**Status:** COMPLETED (with known issues to fix)

#### Description
Create project structure with Bun, TypeScript strict mode, and core dependencies.

#### Before
```
glm-cli/
├── AGENTS.md
├── PRINCIPLES.md
├── README.md
└── docs/
```

#### After
```
glm-cli/
├── AGENTS.md
├── PRINCIPLES.md
├── README.md
├── docs/
├── src/
│   └── index.tsx
├── package.json
├── tsconfig.json
├── bunfig.toml
└── .gitignore
```

#### Steps
1. Run `bun init` to create package.json
2. Create tsconfig.json with strict mode AND JSX configuration:
   ```json
   {
     "compilerOptions": {
       "jsx": "preserve",
       "jsxImportSource": "@opentui/solid",
       "strict": true,
       // ... other strict options
     }
   }
   ```
3. Create bunfig.toml with Solid preload:
   ```toml
   preload = ["@opentui/solid/preload"]
   ```
4. Create src/index.tsx with placeholder entry point (note .tsx extension)
5. Add dependencies to package.json:
   - `@opentui/core` (NOT platform-specific package)
   - `@opentui/solid`
   - `solid-js`
   - `openai`, `zod`
6. Create .gitignore with node_modules, dist, .env
7. Run `bun install` to verify

#### Known Issues (to fix)
- tsconfig.json missing `jsx` and `jsxImportSource` settings
- bunfig.toml missing `preload` for Solid
- package.json using `@opentui/core-linux-x64` instead of `@opentui/core`

#### Verification
- [ ] `bun install` completes without errors
- [ ] `bun run src/index.tsx` executes without errors
- [ ] TypeScript strict mode catches type errors
- [ ] All dependencies listed in package.json
- [ ] JSX files compile correctly with Solid transform

---

### Task 1.2: Global Paths Configuration

**Prerequisites:** Task 1.1
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Create Global namespace with path configuration for config, data, and logs directories.

#### Before
```typescript
// No global path configuration exists
```

#### After
```typescript
// src/global.ts
export namespace Global {
  export namespace Path {
    export const config: string  // ~/.config/glm-cli
    export const data: string    // ~/.config/glm-cli
    export const logs: string    // ~/.config/glm-cli/logs
  }
}
```

#### Steps
1. Create `src/global.ts`
2. Define Path namespace with config, data, logs paths
3. Use `os.homedir()` for cross-platform home directory
4. Export namespace for use throughout application

#### Verification
- [ ] Paths resolve correctly on current platform
- [ ] Global.Path.config returns ~/.config/glm-cli
- [ ] Importing Global works from other files

---

### Task 1.3: Storage Module

**Prerequisites:** Task 1.2
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement file-based storage with read/write/list/remove operations.

**Reference:** See [specs/storage.md](specs/storage.md) for full specification.

#### Before
```
src/
└── global.ts
```

#### After
```
src/
├── global.ts
└── storage/
    ├── index.ts
    └── storage.ts
```

#### Steps
1. Create `src/storage/storage.ts` with Storage namespace
2. Implement `read<T>(key: string[]): Promise<T>`
3. Implement `write<T>(key: string[], content: T): Promise<void>`
4. Implement `update<T>(key: string[], fn): Promise<T>`
5. Implement `remove(key: string[]): Promise<void>`
6. Implement `list(prefix: string[]): Promise<string[][]>`
7. Create NotFoundError for missing files
8. Add automatic parent directory creation
9. Create `src/storage/index.ts` with re-exports

#### Verification
- [ ] Can write and read JSON data
- [ ] NotFoundError thrown for missing files
- [ ] Parent directories created automatically
- [ ] List returns correct keys under prefix

---

### Task 1.4: File Locking Utility

**Prerequisites:** Task 1.1
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement read/write file locking to prevent corruption from concurrent access.

#### Before
```
src/
├── global.ts
└── storage/
```

#### After
```
src/
├── global.ts
├── storage/
└── util/
    └── lock.ts
```

#### Steps
1. Create `src/util/lock.ts`
2. Implement `Lock.read(path)` for shared read locks
3. Implement `Lock.write(path)` for exclusive write locks
4. Use `using` syntax for automatic cleanup
5. Handle lock timeouts gracefully

#### Verification
- [ ] Read locks allow concurrent reads
- [ ] Write locks are exclusive
- [ ] Locks release on scope exit
- [ ] Timeout prevents deadlocks

---

### Task 1.5: Event Bus

**Prerequisites:** Task 1.1
**Dependencies:** zod
**Estimated Effort:** Medium

#### Description
Implement publish/subscribe event bus for decoupled component communication.

**Reference:** See [specs/event-bus.md](specs/event-bus.md) for full specification.

#### Before
```
src/
├── global.ts
├── storage/
└── util/
```

#### After
```
src/
├── global.ts
├── storage/
├── util/
└── bus/
    ├── index.ts
    ├── bus.ts
    └── events.ts
```

#### Steps
1. Create `src/bus/bus.ts` with BusEvent namespace
2. Implement `BusEvent.define(name, schema)` for type-safe events
3. Create Bus singleton with subscribe/publish methods
4. Validate event payloads with Zod schemas
5. Create `src/bus/events.ts` with initial event definitions:
   - `todo.updated`
   - `session.updated`
   - `message.updated`
6. Create `src/bus/index.ts` with re-exports

#### Verification
- [ ] Events publish to all subscribers
- [ ] Invalid payloads throw validation errors
- [ ] Unsubscribe removes listener
- [ ] Type inference works for event payloads

---

### Task 1.6: Configuration System

**Prerequisites:** Task 1.3
**Dependencies:** zod
**Estimated Effort:** Medium

#### Description
Implement configuration loader with Zod validation and environment variable support.

#### Before
```
src/
├── global.ts
├── storage/
├── util/
└── bus/
```

#### After
```
src/
├── global.ts
├── storage/
├── util/
│   ├── lock.ts
│   └── config.ts
└── bus/
```

#### Steps
1. Create `src/util/config.ts`
2. Define ConfigSchema with Zod:
   - `apiKey: string`
   - `defaultModel: string` (default: "glm-4.7")
   - `defaultMode: string` (default: "AUTO")
   - `thinking: boolean` (default: true)
3. Load from `~/.config/glm-cli/config.json`
4. Override with environment variables (GLM_API_KEY)
5. Validate with Zod schema
6. Provide sensible defaults for optional fields
7. Export typed Config object

#### Verification
- [ ] Loads config from JSON file
- [ ] Environment variables override file config
- [ ] Missing optional fields get defaults
- [ ] Invalid config throws validation error

---

### Task 1.7: Logger Utility

**Prerequisites:** Task 1.2
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Create logging utility with level control and file output.

#### Before
```
src/util/
├── lock.ts
└── config.ts
```

#### After
```
src/util/
├── lock.ts
├── config.ts
└── logger.ts
```

#### Steps
1. Create `src/util/logger.ts`
2. Define log levels: debug, info, warn, error
3. Implement file output to `~/.config/glm-cli/logs/glm-cli.log`
4. Add timestamp to each log entry
5. Create redaction for API keys in log output
6. Export Log namespace with level-specific methods

#### Verification
- [ ] Logs written to file
- [ ] Log levels filter correctly
- [ ] API keys redacted from output
- [ ] Timestamps present on entries

---

### Task 1.8: GLM API Client

**Prerequisites:** Task 1.6, Task 1.7
**Dependencies:** openai
**Estimated Effort:** Medium

#### Description
Implement OpenAI-compatible client for Z.AI Coding Plan API.

#### Before
```
src/
├── util/
├── bus/
└── storage/
```

#### After
```
src/
├── util/
├── bus/
├── storage/
└── api/
    ├── index.ts
    ├── client.ts
    └── types.ts
```

#### Steps
1. Create `src/api/types.ts` with API type definitions
2. Create `src/api/client.ts` with GLMClient class
3. Configure base URL: `https://api.z.ai/api/coding/paas/v4/`
4. Implement chat completion method
5. Support all 8 GLM models in type definitions
6. Handle authentication with API key
7. Add retry logic with exponential backoff (5 retries)
8. Create `src/api/index.ts` with re-exports

#### Verification
- [ ] Successfully connects to API
- [ ] Returns typed responses
- [ ] Retries on transient failures
- [ ] Auth errors handled gracefully

---

### Task 1.9: Streaming Handler

**Prerequisites:** Task 1.8
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement SSE stream parsing with thinking content extraction.

#### Before
```
src/api/
├── index.ts
├── client.ts
└── types.ts
```

#### After
```
src/api/
├── index.ts
├── client.ts
├── types.ts
└── stream.ts
```

#### Steps
1. Create `src/api/stream.ts`
2. Implement SSE chunk parsing
3. Extract `reasoning_content` to separate buffer
4. Extract `content` to main response buffer
5. Handle stream errors gracefully
6. Support abort/cancel via AbortController
7. Emit parsed chunks for consumption

#### Verification
- [ ] Parses SSE format correctly
- [ ] Thinking content extracted separately
- [ ] Stream can be aborted mid-flight
- [ ] Connection errors handled

---

### Task 1.10: Instruction File Discovery

**Prerequisites:** Task 1.1
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement instruction file loader with priority order discovery.

#### Before
```
src/util/
├── lock.ts
├── config.ts
└── logger.ts
```

#### After
```
src/util/
├── lock.ts
├── config.ts
├── logger.ts
└── instructions.ts
```

#### Steps
1. Create `src/util/instructions.ts`
2. Define priority order array:
   - `.glm-cli/instructions.md`
   - `AGENTS.md`
   - `CLAUDE.md`
   - `GEMINI.md`
   - `QWEN.md`
   - `KIMI.md`
   - `COPILOT.md`
   - `.cursorrules`
   - `.windsurfrules`
3. Implement `findInstructions(dir)` to find first matching file
4. Implement `loadInstructions(dir)` to read content
5. Cache result for session duration

#### Verification
- [ ] Finds files in priority order
- [ ] Returns first found file
- [ ] Handles missing files gracefully
- [ ] Cache prevents redundant reads

---

### Task 1.11: Design Constants File

**Prerequisites:** Task 1.1
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Create centralized design constants for colors, indicators, and spacing values used throughout the UI.

#### Before
```
src/ui/
└── (empty or missing)
```

#### After
```
src/ui/
└── design.ts
```

#### Steps
1. Create `src/ui/design.ts`
2. Define Colors namespace with mode colors:
   - AUTO: `#ffffff`
   - AGENT: `#5cffff`
   - PLANNER: `#b48eff`
   - PLAN-PRD: `#5c8fff`
   - DEBUG: `#ffaa5c`
3. Define Colors namespace with status colors:
   - success: `#6fca6f`
   - warning: `#e6c655`
   - error: `#ff6b6b`
   - info: `#5c8fff`
4. Define Colors namespace with UI colors:
   - primary: `#5cffff`
   - secondary/dim: `#666666`
   - text: `#ffffff`
5. Define Indicators namespace:
   - collapsed: `▶`, expanded: `▼`
   - todo status: `[ ]`, `[>]`, `[x]`, `[-]`
   - tool status: `[OK]`, `[FAIL]`
   - progress: `█`, `░`
6. Export as `const` for type safety

#### Expected Output
```typescript
// src/ui/design.ts
export const Colors = {
  mode: {
    AUTO: "#ffffff",
    AGENT: "#5cffff",
    PLANNER: "#b48eff",
    "PLAN-PRD": "#5c8fff",
    DEBUG: "#ffaa5c",
  },
  status: {
    success: "#6fca6f",
    warning: "#e6c655",
    error: "#ff6b6b",
    info: "#5c8fff",
  },
  ui: {
    primary: "#5cffff",
    secondary: "#666666",
    text: "#ffffff",
    dim: "#666666",
  },
} as const

export const Indicators = {
  collapsed: "▶",
  expanded: "▼",
  todo: {
    pending: "[ ]",
    in_progress: "[>]",
    completed: "[x]",
    cancelled: "[-]",
  },
  tool: {
    success: "[OK]",
    error: "[FAIL]",
  },
  progress: {
    filled: "█",
    empty: "░",
  },
} as const

export type Mode = keyof typeof Colors.mode
export type Status = keyof typeof Colors.status
```

#### Verification
- [ ] All mode colors defined
- [ ] All status colors defined
- [ ] All ASCII indicators defined
- [ ] TypeScript types exported
- [ ] Can import in other files

---

## Phase 2: Core UI + Modes

> OpenTUI setup, core components, sidebar, and mode system

**Important OpenTUI/Solid Patterns:**
- Use underscore naming for multi-word components: `<tab_select>`, `<ascii_font>`, `<line_number>`
- Use `onInput` not `onChange` for input components
- Call signals with `()`: `count()` not `count`
- Don't destructure props: use `props.value` not `{ value }`
- Never use `process.exit()` - use `renderer.destroy()`
- ScrollBox needs explicit height prop
- Text styling uses nested tags: `<strong>`, `<em>`, `<span fg="...">`

---

### Task 2.0: Welcome Screen Component

**Prerequisites:** Task 2.1, Task 1.11
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create the welcome/startup screen with ASCII logo, version info, and initial input area.

#### Before
```
src/ui/components/
└── (empty)
```

#### After
```
src/ui/components/
└── WelcomeScreen.tsx
```

#### Steps
1. Create `src/ui/components/WelcomeScreen.tsx`
2. Implement ASCII logo using `<ascii_font>` or manual box drawing
3. Apply cyan-to-dim gradient to logo (left to right)
4. Display version and build date (left/right aligned)
5. Display current model and working directory
6. Show input area below logo (reuse InputArea component)
7. Show status line at bottom

#### Visual Specification
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                            │
│     ██████╗ ██╗     ███╗   ███╗       ██████╗██╗     ██╗                                                   │
│    ██╔════╝ ██║     ████╗ ████║      ██╔════╝██║     ██║                                                   │
│    ██║  ███╗██║     ██╔████╔██║█████╗██║     ██║     ██║                                                   │
│    ██║   ██║██║     ██║╚██╔╝██║╚════╝██║     ██║     ██║                                                   │
│    ╚██████╔╝███████╗██║ ╚═╝ ██║      ╚██████╗███████╗██║                                                   │
│     ╚═════╝ ╚══════╝╚═╝     ╚═╝       ╚═════╝╚══════╝╚═╝                                                   │
│                                                                                                            │
│    v0.1.0                                                              built 01-20-2026                    │
│    Model: GLM-4.7                                                      Dir: ~/glm-cli                      │
│                                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─ AUTO (Thinking) ──────────────────────────────────────────────────────────────────────────────────────────┐
│  > _                                                                                                       │
│    What are we building, breaking, or making better?                                                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
GLM-4.7 │ AUTO │ [░░░░░░░░░░] 0% │ ~/glm-cli │  main │ MCPs: 4/4 │ 01-20-2026
```

#### Verification
- [ ] ASCII logo displays with gradient
- [ ] Version and date visible
- [ ] Model and directory visible
- [ ] Input area functional
- [ ] Status line shows initial state

---

### Task 2.1: OpenTUI App Shell

**Prerequisites:** Phase 1 complete
**Dependencies:** @opentui/core, @opentui/solid, solid-js
**Estimated Effort:** Medium

#### Description
Create root App component with OpenTUI + SolidJS integration.

#### Before
```
src/
├── index.ts (placeholder)
└── ... (Phase 1 modules)
```

#### After
```
src/
├── index.tsx (entry point - note .tsx extension)
└── ui/
    ├── App.tsx
    ├── design.ts
    └── index.ts
```

#### Steps
1. Rename `src/index.ts` to `src/index.tsx`
2. Create `src/ui/App.tsx` with root component
3. Initialize OpenTUI renderer using `render()` from `@opentui/solid`
4. Set up full terminal size layout using flexbox:
   ```tsx
   <box flexDirection="column" width="100%" height="100%">
     {/* Content */}
   </box>
   ```
5. Use `useRenderer()` hook to access renderer
6. Implement double-press Ctrl+C exit handler using `useKeyboard()`:
   ```tsx
   const renderer = useRenderer()
   let ctrlCCount = 0
   useKeyboard((key) => {
     if (key.ctrl && key.name === "c") {
       ctrlCCount++
       if (ctrlCCount >= 2) renderer.destroy()
       setTimeout(() => ctrlCCount = 0, 500)
     }
   })
   ```
7. **NEVER use `process.exit()` directly** - always use `renderer.destroy()`
8. Create `src/ui/index.ts` with re-exports

#### OpenTUI Patterns
```tsx
import { render, useRenderer, useKeyboard } from "@opentui/solid"

function App() {
  const renderer = useRenderer()
  
  // Exit handler
  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer.destroy()  // NOT process.exit()!
    }
  })
  
  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Main content */}
    </box>
  )
}

render(() => <App />)
```

#### Verification
- [ ] App renders to terminal
- [ ] Full terminal size utilized
- [ ] Ctrl+C (2x) exits cleanly via `renderer.destroy()`
- [ ] No render errors on startup
- [ ] Terminal restored properly on exit

---

### Task 2.2: Status Line Component

**Prerequisites:** Task 2.1, Task 1.11
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement bottom status line with comprehensive information display.

#### Before
```
src/ui/
├── App.tsx
└── index.ts
```

#### After
```
src/ui/
├── App.tsx
├── index.ts
└── components/
    ├── StatusLine.tsx
    └── ProgressBar.tsx
```

#### Visual Specification
```
GLM-4.7 │ AGENT │ [██████░░░░] 62% │ ~/glm-cli │  main │ MCPs: 4/4 │ 01-20-2026
```

During tool execution:
```
GLM-4.7 │ AGENT │ [████░░░░░░] 42% │ ~/glm-cli │  main │ MCPs: 4/4 │ file_write...
```

#### Steps
1. Create `src/ui/components/StatusLine.tsx`
2. Create `src/ui/components/ProgressBar.tsx` helper component
3. Import colors from `src/ui/design.ts`
4. Display segments separated by `│`:
   - Model name (white)
   - Mode (mode-specific color from Colors.mode)
   - Context usage progress bar with percentage
   - Working directory (dim, truncated with ellipsis)
   - Git branch with  icon (dim)
   - MCP status (green if all connected)
   - Date or current tool activity (dim)
5. Use nested `<span>` tags for coloring:
   ```tsx
   <text>
     <span fg={Colors.ui.text}>{model}</span>
     <span fg={Colors.ui.dim}> │ </span>
     <span fg={Colors.mode[mode()]}>{mode()}</span>
   </text>
   ```
6. Position at bottom using flexbox (fixed height of 1)

#### Progress Bar Implementation
```tsx
function ProgressBar(props: { percent: number; width?: number }) {
  const width = props.width ?? 10
  const filled = Math.round((props.percent / 100) * width)
  const empty = width - filled
  
  return (
    <text>
      <span fg={Colors.ui.text}>[</span>
      <span fg={Colors.ui.text}>{Indicators.progress.filled.repeat(filled)}</span>
      <span fg={Colors.ui.dim}>{Indicators.progress.empty.repeat(empty)}</span>
      <span fg={Colors.ui.text}>] {props.percent}%</span>
    </text>
  )
}
```

#### Verification
- [ ] Mode displays with correct color from design constants
- [ ] Model name visible
- [ ] Progress bar shows context percentage
- [ ] Git branch displayed
- [ ] MCP status shows connected count
- [ ] Date/activity shown
- [ ] Positioned at terminal bottom (height: 1)

---

### Task 2.3: Input Area Component

**Prerequisites:** Task 2.1, Task 1.11
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create boxed input area with mode in title, ghost text, and multi-line support.

#### Before
```
src/ui/components/
└── StatusLine.tsx
```

#### After
```
src/ui/components/
├── StatusLine.tsx
├── ProgressBar.tsx
└── InputArea.tsx
```

#### Visual Specification
Empty with ghost text:
```
┌─ AGENT (Thinking) ──────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  > _                                                                                │
│                                                                                     │
│    What are we building, breaking, or making better?                                │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

With content:
```
┌─ AGENT (Thinking) ──────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  > Can you help me implement a streaming handler?                                   │
│    I need it to:                                                                    │
│    - Parse SSE chunks                                                               │
│    - Extract thinking content_                                                      │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

#### Steps
1. Create `src/ui/components/InputArea.tsx`
2. Wrap in `<box>` with border and title showing mode + "(Thinking)" if enabled
3. Use `<textarea>` for multi-line input (or `<input>` with custom handling)
4. **Use `onInput` not `onChange`** (Solid convention):
   ```tsx
   <input
     value={value()}
     onInput={setValue}
     placeholder="..."
     focused
   />
   ```
5. Show prompt cursor `>` before input
6. Show ghost text below prompt when empty (dim color)
7. Handle Shift+Enter for newline insertion
8. Handle Enter for submission
9. Title format: `─ MODE (Thinking) ─` with mode color

#### Implementation Pattern
```tsx
function InputArea() {
  const [value, setValue] = createSignal("")
  const { mode, thinking } = useMode()
  
  return (
    <box 
      border 
      title={`${mode()}${thinking() ? " (Thinking)" : ""}`}
      titleAlignment="left"
    >
      <box flexDirection="column" padding={1}>
        <box flexDirection="row">
          <text fg={Colors.ui.dim}>{">"} </text>
          <input
            value={value()}
            onInput={setValue}
            focused
          />
        </box>
        <Show when={!value()}>
          <text fg={Colors.ui.dim}>
            {"  "}What are we building, breaking, or making better?
          </text>
        </Show>
      </box>
    </box>
  )
}
```

#### Verification
- [ ] Box with border displays
- [ ] Mode shown in title with correct color
- [ ] "(Thinking)" shown when enabled
- [ ] Prompt cursor `>` visible
- [ ] Ghost text shows when empty (dim)
- [ ] Shift+Enter adds newline
- [ ] Enter submits content
- [ ] Input receives keyboard focus

---

### Task 2.4: Chat View Component

**Prerequisites:** Task 2.1
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement scrollable message list with auto-scroll.

#### Before
```
src/ui/components/
├── StatusLine.tsx
└── InputArea.tsx
```

#### After
```
src/ui/components/
├── StatusLine.tsx
├── InputArea.tsx
└── ChatView.tsx
```

#### Steps
1. Create `src/ui/components/ChatView.tsx`
2. Use OpenTUI scrollbox component
3. Enable stickyScroll for auto-scroll on new messages
4. Implement arrow key navigation
5. Add mouse scroll support
6. Render messages from Messages store

#### Verification
- [ ] Messages display in scrollable area
- [ ] Auto-scrolls on new messages
- [ ] Arrow keys navigate scroll
- [ ] Mouse scroll works

---

### Task 2.5: Message Block Component

**Prerequisites:** Task 2.4
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create message display with role-based styling and markdown rendering.

#### Before
```
src/ui/components/
├── StatusLine.tsx
├── InputArea.tsx
└── ChatView.tsx
```

#### After
```
src/ui/components/
├── StatusLine.tsx
├── InputArea.tsx
├── ChatView.tsx
└── MessageBlock.tsx
```

#### Steps
1. Create `src/ui/components/MessageBlock.tsx`
2. Style user messages distinctly (right-aligned or prefixed)
3. Style assistant messages with streaming support
4. Implement basic markdown rendering (bold, code, lists)
5. Add syntax highlighting for code blocks
6. Handle streaming updates efficiently

#### Verification
- [ ] User/assistant messages styled differently
- [ ] Markdown renders correctly
- [ ] Code blocks highlighted
- [ ] Streaming updates smoothly

---

### Task 2.6: Thinking Block Component

**Prerequisites:** Task 2.5
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement collapsible thinking display.

#### Before
```
src/ui/components/
├── ...
└── MessageBlock.tsx
```

#### After
```
src/ui/components/
├── ...
├── MessageBlock.tsx
└── ThinkingBlock.tsx
```

#### Steps
1. Create `src/ui/components/ThinkingBlock.tsx`
2. Show expanded during streaming
3. Collapse by default after generation completes
4. Add "Thinking..." label
5. Toggle expand/collapse with Enter or arrow key
6. Use muted color for collapsed state

#### Verification
- [ ] Expands during streaming
- [ ] Collapses after completion
- [ ] Toggle works with keyboard
- [ ] Shows "Thinking..." label

---

### Task 2.7: Tool Block Component

**Prerequisites:** Task 2.5, Task 1.11
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create collapsible tool result display with diff support.

#### Before
```
src/ui/components/
├── ...
└── ThinkingBlock.tsx
```

#### After
```
src/ui/components/
├── ...
├── ThinkingBlock.tsx
└── ToolBlock.tsx
```

#### Visual Specification

Collapsed:
```
▶ file_read src/api/client.ts                                                     [OK]
```

Expanded:
```
▼ file_read src/api/client.ts                                                     [OK]
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  1  import { OpenAI } from "openai"                                                │
  │  2                                                                                 │
  │  3  export class GLMClient {                                                       │
  └────────────────────────────────────────────────────────────────────────────────────┘
```

With diff:
```
▼ file_edit src/api/client.ts                                                     [OK]
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  + import { z } from "zod"                                                         │
  │    import { OpenAI } from "openai"                                                 │
  │  - old line                                                                        │
  │  + new line                                                                        │
  └────────────────────────────────────────────────────────────────────────────────────┘
```

Error state:
```
▶ bash npm install                                                               [FAIL]
```

#### Steps
1. Create `src/ui/components/ToolBlock.tsx`
2. Import indicators from `src/ui/design.ts`
3. Display collapsed state by default:
   - Indicator: `▶` (Indicators.collapsed)
   - Tool name
   - Path/arguments (dim)
   - Status: `[OK]` green or `[FAIL]` red
4. Handle click/Enter to toggle expand
5. Expanded state shows content in bordered box:
   - Indented with 2 spaces
   - Line numbers for file content
   - Diff coloring: `+` green, `-` red
6. Use `<code>` or `<line_number>` for syntax highlighting

#### Implementation Pattern
```tsx
function ToolBlock(props: { tool: ToolResult }) {
  const [expanded, setExpanded] = createSignal(false)
  
  const statusText = () => props.tool.success 
    ? Indicators.tool.success 
    : Indicators.tool.error
  const statusColor = () => props.tool.success 
    ? Colors.status.success 
    : Colors.status.error
  
  return (
    <box flexDirection="column">
      <box 
        flexDirection="row" 
        onMouseDown={() => setExpanded(e => !e)}
      >
        <text fg={Colors.ui.dim}>
          {expanded() ? Indicators.expanded : Indicators.collapsed}{" "}
        </text>
        <text>{props.tool.name} </text>
        <text fg={Colors.ui.dim}>{props.tool.path}</text>
        <box flexGrow={1} />
        <text fg={statusColor()}>{statusText()}</text>
      </box>
      
      <Show when={expanded()}>
        <box border marginLeft={2} marginTop={1}>
          <line_number
            code={props.tool.output}
            language={props.tool.language ?? "text"}
          />
        </box>
      </Show>
    </box>
  )
}
```

#### Verification
- [ ] Shows `▶` when collapsed, `▼` when expanded
- [ ] Tool name and path displayed
- [ ] `[OK]` green for success, `[FAIL]` red for error
- [ ] Click/Enter toggles expanded state
- [ ] Content shows in bordered box when expanded
- [ ] Diff lines colored correctly (+green, -red)
- [ ] Collapsed by default

---

### Task 2.8: Sidebar Panel Component

**Prerequisites:** Task 2.1
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create right sidebar with session info, todos, MCP status.

#### Before
```
src/ui/components/
├── ...
└── ToolBlock.tsx
```

#### After
```
src/ui/components/
├── ...
├── ToolBlock.tsx
└── Sidebar.tsx
```

#### Steps
1. Create `src/ui/components/Sidebar.tsx`
2. Set fixed width (42 chars)
3. Add session title section
4. Add context usage section (tokens, percentage, cost)
5. Add collapsible MCP section
6. Add collapsible Todo section
7. Add collapsible Modified Files section
8. Implement click to expand/collapse

#### Verification
- [ ] Fixed width sidebar
- [ ] Session info displays
- [ ] Sections collapsible
- [ ] Click toggles sections

---

### Task 2.9: Todo Item Component

**Prerequisites:** Task 2.8, Task 1.11
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Create individual todo display component with ASCII status indicators.

#### Before
```
src/ui/components/
├── ...
└── Sidebar.tsx
```

#### After
```
src/ui/components/
├── ...
├── Sidebar.tsx
└── TodoItem.tsx
```

#### Visual Specification
```
[ ] Set up project structure          <- pending (dim)
[>] Implement API client              <- in_progress (cyan)
[ ] Add error handling                <- pending (dim)
[x] Write configuration loader        <- completed (dim)
[-] Cancelled task                    <- cancelled (dim)
```

#### Steps
1. Create `src/ui/components/TodoItem.tsx`
2. Import indicators and colors from `src/ui/design.ts`
3. Map status to indicator:
   - pending: `Indicators.todo.pending` (`[ ]`)
   - in_progress: `Indicators.todo.in_progress` (`[>]`)
   - completed: `Indicators.todo.completed` (`[x]`)
   - cancelled: `Indicators.todo.cancelled` (`[-]`)
4. Color based on status:
   - in_progress: `Colors.mode.AGENT` (cyan `#5cffff`)
   - All others: `Colors.ui.dim` (gray `#666666`)
5. Display content with word wrap
6. **No emojis** - ASCII only (brutalist design)

#### Implementation Pattern
```tsx
function TodoItem(props: { todo: Todo }) {
  const indicator = () => Indicators.todo[props.todo.status]
  const color = () => props.todo.status === "in_progress" 
    ? Colors.mode.AGENT 
    : Colors.ui.dim
  
  return (
    <text>
      <span fg={color()}>{indicator()}</span>
      <span fg={color()}> {props.todo.content}</span>
    </text>
  )
}
```

#### Verification
- [ ] `[ ]` for pending
- [ ] `[>]` for in_progress (cyan)
- [ ] `[x]` for completed
- [ ] `[-]` for cancelled
- [ ] Only in_progress is cyan, others are dim
- [ ] Content displays correctly
- [ ] No emojis anywhere

---

### Task 2.10: Overlay System

**Prerequisites:** Task 2.1
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement modal overlay for commands and dialogs.

#### Before
```
src/ui/components/
├── ...
└── TodoItem.tsx
```

#### After
```
src/ui/components/
├── ...
├── TodoItem.tsx
└── Overlay.tsx
```

#### Steps
1. Create `src/ui/components/Overlay.tsx`
2. Cover main content when active
3. Handle Esc to close overlay
4. Support list selection mode
5. Support form input mode
6. Position centered or anchored

#### Verification
- [ ] Covers main content
- [ ] Esc closes overlay
- [ ] List selection works
- [ ] Form input works

---

### Task 2.11: Mode Context

**Prerequisites:** Task 2.1, Task 1.5
**Dependencies:** solid-js
**Estimated Effort:** Medium

#### Description
Create mode state management and switching logic.

#### Before
```
src/ui/
├── App.tsx
├── index.ts
└── components/
```

#### After
```
src/ui/
├── App.tsx
├── index.ts
├── components/
└── context/
    └── mode.tsx
```

#### Steps
1. Create `src/ui/context/mode.tsx`
2. Define Mode enum: AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG
3. Create ModeProvider with current mode state
4. Implement cycleMode() for Tab
5. Implement cycleModeReverse() for Shift+Tab
6. Persist mode in session state

#### Verification
- [ ] 5 modes defined
- [ ] Tab cycles forward
- [ ] Shift+Tab cycles backward
- [ ] Mode persists

---

### Task 2.12: Session Context

**Prerequisites:** Task 2.1, Task 1.5, Task 1.3
**Dependencies:** solid-js
**Estimated Effort:** Medium

#### Description
Implement session state management with messages, model, and stats.

#### Before
```
src/ui/context/
└── mode.tsx
```

#### After
```
src/ui/context/
├── mode.tsx
└── session.tsx
```

#### Steps
1. Create `src/ui/context/session.tsx`
2. Create SessionProvider with:
   - messages: Message[]
   - model: current model
   - thinking: boolean toggle
   - stats: token counts, cost
3. Implement addMessage, updateMessage methods
4. Subscribe to relevant bus events
5. Wire up auto-save logic (placeholder)

#### Verification
- [ ] Messages store works
- [ ] Model tracking works
- [ ] Thinking toggle works
- [ ] Stats accumulate

---

### Task 2.13: Todo Context

**Prerequisites:** Task 2.1, Task 1.5, Task 1.3
**Dependencies:** solid-js
**Estimated Effort:** Small

#### Description
Implement todo state management with event subscription.

#### Before
```
src/ui/context/
├── mode.tsx
└── session.tsx
```

#### After
```
src/ui/context/
├── mode.tsx
├── session.tsx
└── todo.tsx
```

#### Steps
1. Create `src/ui/context/todo.tsx`
2. Create TodoProvider with todos per session
3. Subscribe to `todo.updated` bus event
4. Update store on event received
5. Provide todos to Sidebar component

#### Verification
- [ ] Todos load for session
- [ ] Bus events update UI
- [ ] Sidebar receives todos

---

### Task 2.14: Keyboard Shortcuts

**Prerequisites:** Task 2.1, Task 2.11
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement global keyboard shortcut handler.

#### Before
```
src/
└── ui/
```

#### After
```
src/
├── ui/
└── input/
    ├── handler.ts
    └── shortcuts.ts
```

#### Steps
1. Create `src/input/shortcuts.ts` with shortcut definitions
2. Create `src/input/handler.ts` with event processing
3. Implement Tab/Shift+Tab for mode cycling
4. Implement Ctrl+P for command palette
5. Implement Ctrl+M for MCP status
6. Implement double-press Esc for cancel
7. Implement double-press Ctrl+C for exit

#### Verification
- [ ] Tab cycles modes
- [ ] Ctrl+P opens palette
- [ ] Ctrl+M opens MCP status
- [ ] Double Esc cancels
- [ ] Double Ctrl+C exits

---

## Phase 3: MCP Integration

> Connect all 4 MCP servers

---

### Task 3.1: MCP Manager

**Prerequisites:** Phase 2 complete
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create MCP connection manager with single API key configuration.

#### Before
```
src/
├── api/
├── ui/
└── input/
```

#### After
```
src/
├── api/
├── ui/
├── input/
└── mcp/
    ├── index.ts
    └── manager.ts
```

#### Steps
1. Create `src/mcp/manager.ts`
2. Define MCPManager class
3. Initialize all 4 MCP servers on startup
4. Use single API key from config
5. Track connection status per server
6. Implement graceful failure handling
7. Create `src/mcp/index.ts` with re-exports

#### Verification
- [ ] All 4 MCPs initialize
- [ ] Single API key used
- [ ] Status tracked per server
- [ ] Failures don't crash app

---

### Task 3.2: Vision MCP (Stdio)

**Prerequisites:** Task 3.1
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement local Vision MCP client using stdio transport.

#### Before
```
src/mcp/
├── index.ts
└── manager.ts
```

#### After
```
src/mcp/
├── index.ts
├── manager.ts
└── vision.ts
```

#### Steps
1. Create `src/mcp/vision.ts`
2. Spawn local Vision MCP process
3. Implement stdio communication
4. Register all 8 vision tools
5. Handle image data encoding
6. Manage process lifecycle (start/stop)

#### Verification
- [ ] Process spawns successfully
- [ ] All 8 tools registered
- [ ] Image analysis works
- [ ] Process cleanup on exit

---

### Task 3.3: Web Search MCP (HTTP)

**Prerequisites:** Task 3.1
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement remote Web Search MCP client.

#### Before
```
src/mcp/
├── ...
└── vision.ts
```

#### After
```
src/mcp/
├── ...
├── vision.ts
└── web-search.ts
```

#### Steps
1. Create `src/mcp/web-search.ts`
2. Implement HTTP transport connection
3. Register `webSearchPrime` tool
4. Parse search results
5. Handle timeouts

#### Verification
- [ ] Connects to remote server
- [ ] Search returns results
- [ ] Timeouts handled

---

### Task 3.4: Web Reader MCP (HTTP)

**Prerequisites:** Task 3.1
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement remote Web Reader MCP client.

#### Before
```
src/mcp/
├── ...
└── web-search.ts
```

#### After
```
src/mcp/
├── ...
├── web-search.ts
└── web-reader.ts
```

#### Steps
1. Create `src/mcp/web-reader.ts`
2. Implement HTTP transport connection
3. Register `webReader` tool
4. Fetch and parse URL content
5. Handle invalid URLs gracefully

#### Verification
- [ ] Connects to remote server
- [ ] URL content fetched
- [ ] Invalid URLs handled

---

### Task 3.5: Zread MCP (HTTP)

**Prerequisites:** Task 3.1
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement remote Zread MCP client.

#### Before
```
src/mcp/
├── ...
└── web-reader.ts
```

#### After
```
src/mcp/
├── ...
├── web-reader.ts
└── zread.ts
```

#### Steps
1. Create `src/mcp/zread.ts`
2. Implement HTTP transport connection
3. Register tools: `search_doc`, `get_repo_structure`, `read_file`
4. Implement response caching for repeated requests
5. Handle connection errors

#### Verification
- [ ] Connects to remote server
- [ ] All 3 tools work
- [ ] Caching reduces requests

---

### Task 3.6: MCP Status Overlay

**Prerequisites:** Task 3.1, Task 2.10
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Create Ctrl+M MCP status display overlay.

#### Before
```
src/ui/components/
└── Overlay.tsx (generic)
```

#### After
```
src/ui/components/
└── Overlay.tsx (with MCP status mode)
```

#### Steps
1. Add MCP status mode to Overlay component
2. Display all 4 MCP servers
3. Show connection status per server (connected/failed/disabled)
4. List available tools per server
5. Show error details for failed connections

#### Verification
- [ ] Ctrl+M opens overlay
- [ ] All 4 servers listed
- [ ] Status accurate
- [ ] Errors displayed

---

## Phase 4: Multi-Modal Input

> Advanced input handling: paste, images, @ references

---

### Task 4.1: Paste Handler

**Prerequisites:** Task 2.3
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Detect and handle multi-line paste events.

#### Before
```
src/input/
├── handler.ts
└── shortcuts.ts
```

#### After
```
src/input/
├── handler.ts
├── shortcuts.ts
└── paste.ts
```

#### Steps
1. Create `src/input/paste.ts`
2. Detect paste vs typing (timing-based)
3. Count lines in pasted content
4. Display "[Pasted ~X lines]" indicator
5. Preserve full content for submission

#### Verification
- [ ] Paste detected correctly
- [ ] Line count accurate
- [ ] Indicator displays
- [ ] Content preserved

---

### Task 4.2: Image Paste Handler

**Prerequisites:** Task 4.1, Task 3.2
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Detect image paste and route to Vision MCP.

#### Before
```
src/input/
└── paste.ts
```

#### After
```
src/input/
└── paste.ts (updated with image support)
```

#### Steps
1. Update `src/input/paste.ts` for image detection
2. Detect image data in clipboard
3. Display "[Image N]" placeholder in input
4. Store image data for submission
5. Route to Vision MCP on submit

#### Verification
- [ ] Image paste detected
- [ ] Placeholder displays
- [ ] Image sent to Vision MCP
- [ ] Multiple images supported

---

### Task 4.3: @ Reference Parser

**Prerequisites:** Task 2.3
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement @ file reference autocomplete trigger.

#### Before
```
src/input/
├── handler.ts
├── shortcuts.ts
└── paste.ts
```

#### After
```
src/input/
├── handler.ts
├── shortcuts.ts
├── paste.ts
└── at-refs.ts
```

#### Steps
1. Create `src/input/at-refs.ts`
2. Detect @ character in input
3. Implement fuzzy filename matching
4. Support @~ for home directory
5. Support @file#10-20 for line ranges
6. Return match candidates

#### Verification
- [ ] @ triggers autocomplete
- [ ] Fuzzy matching works
- [ ] @~ expands home
- [ ] Line ranges parsed

---

### Task 4.4: Autocomplete Dropdown

**Prerequisites:** Task 4.3
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create autocomplete UI for @ references.

#### Before
```
src/ui/components/
└── ... (existing)
```

#### After
```
src/ui/components/
├── ... (existing)
└── Autocomplete.tsx
```

#### Steps
1. Create `src/ui/components/Autocomplete.tsx`
2. Position at cursor location
3. Display matching candidates
4. Arrow key navigation
5. Enter to select
6. Esc to dismiss
7. Scroll for long lists

#### Verification
- [ ] Positioned at cursor
- [ ] Arrow keys navigate
- [ ] Enter selects
- [ ] Esc dismisses

---

### Task 4.5: Message History Navigation

**Prerequisites:** Task 2.3
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement up/down arrow for input history.

#### Before
```
src/input/
└── handler.ts
```

#### After
```
src/input/
└── handler.ts (updated with history)
```

#### Steps
1. Update `src/input/handler.ts` with history
2. Store submitted inputs in history array
3. Up arrow shows previous input
4. Down arrow shows next input
5. Preserve current input when navigating
6. History persists in session

#### Verification
- [ ] Up shows previous
- [ ] Down shows next
- [ ] Current preserved
- [ ] History persists

---

## Phase 5: Agent & Tools

> Agent system, built-in tools, and tool descriptions

---

### Task 5.1: Tool Registry

**Prerequisites:** Phase 2 complete
**Dependencies:** zod
**Estimated Effort:** Medium

#### Description
Create tool registration and validation system.

#### Before
```
src/
├── api/
├── ui/
├── input/
└── mcp/
```

#### After
```
src/
├── api/
├── ui/
├── input/
├── mcp/
└── tools/
    ├── index.ts
    └── registry.ts
```

#### Steps
1. Create `src/tools/registry.ts`
2. Define Tool.define() for type-safe tool registration
3. Implement Zod schema validation for parameters
4. Add timeout handling per tool
5. Implement result formatting
6. Create `src/tools/index.ts` with re-exports

#### Verification
- [ ] Tools register with schemas
- [ ] Parameters validated
- [ ] Timeouts enforced
- [ ] Results formatted

---

### Task 5.2: Tool Description Files

**Prerequisites:** Task 5.1
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create tool description text files for all tools.

**Reference:** See [specs/tool-descriptions.md](specs/tool-descriptions.md) for full content.

#### Before
```
src/tools/
├── index.ts
└── registry.ts
```

#### After
```
src/tools/
├── index.ts
├── registry.ts
├── todo-write.txt
├── todo-read.txt
├── file-read.txt
├── file-write.txt
├── file-edit.txt
├── glob.txt
├── grep.txt
├── bash.txt
└── task.txt
```

#### Steps
1. Create each .txt file with content from specs/tool-descriptions.md
2. Ensure descriptions include:
   - What the tool does
   - When to use / when NOT to use
   - Examples where applicable
   - Parameter descriptions

#### Verification
- [ ] All tool descriptions created
- [ ] Content matches specification
- [ ] Files import correctly

---

### Task 5.3: File Read Tool

**Prerequisites:** Task 5.1, Task 5.2
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement file read with line range support.

#### Before
```
src/tools/
├── registry.ts
└── *.txt
```

#### After
```
src/tools/
├── registry.ts
├── *.txt
└── file-read.ts
```

#### Steps
1. Create `src/tools/file-read.ts`
2. Import description from file-read.txt
3. Define Zod schema: filePath (required), offset, limit
4. Implement file reading with Bun.file()
5. Support line range via offset/limit
6. Handle binary files gracefully
7. Respect 2000 line default limit

#### Verification
- [ ] Reads files correctly
- [ ] Line range works
- [ ] Binary files handled
- [ ] Large files truncated

---

### Task 5.4: File Write Tool

**Prerequisites:** Task 5.1, Task 5.2
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement file write with parent directory creation.

#### Before
```
src/tools/
└── file-read.ts
```

#### After
```
src/tools/
├── file-read.ts
└── file-write.ts
```

#### Steps
1. Create `src/tools/file-write.ts`
2. Import description from file-write.txt
3. Define Zod schema: filePath, content (both required)
4. Create parent directories if missing
5. Write file content
6. Preserve file permissions on overwrite

#### Verification
- [ ] Creates new files
- [ ] Creates parent dirs
- [ ] Overwrites existing
- [ ] Permissions preserved

---

### Task 5.5: File Edit Tool

**Prerequisites:** Task 5.1, Task 5.2
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement targeted file editing with find/replace.

#### Before
```
src/tools/
└── file-write.ts
```

#### After
```
src/tools/
├── file-write.ts
└── file-edit.ts
```

#### Steps
1. Create `src/tools/file-edit.ts`
2. Import description from file-edit.txt
3. Define Zod schema: filePath, oldString, newString, replaceAll
4. Find oldString in file content
5. Replace with newString
6. Error if not found or multiple matches (unless replaceAll)
7. Write atomically

#### Verification
- [ ] Find/replace works
- [ ] Error on not found
- [ ] replaceAll handles multiples
- [ ] Atomic write

---

### Task 5.6: Glob Tool

**Prerequisites:** Task 5.1, Task 5.2
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement file pattern matching.

#### Before
```
src/tools/
└── file-edit.ts
```

#### After
```
src/tools/
├── file-edit.ts
└── glob.ts
```

#### Steps
1. Create `src/tools/glob.ts`
2. Import description from glob.txt
3. Define Zod schema: pattern (required), path (optional)
4. Use Bun.Glob for matching
5. Support recursive patterns (**)
6. Respect .gitignore
7. Return sorted results

#### Verification
- [ ] Glob patterns work
- [ ] Recursive matching works
- [ ] .gitignore respected
- [ ] Results sorted

---

### Task 5.7: Grep Tool

**Prerequisites:** Task 5.1, Task 5.2
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement content search with regex.

#### Before
```
src/tools/
└── glob.ts
```

#### After
```
src/tools/
├── glob.ts
└── grep.ts
```

#### Steps
1. Create `src/tools/grep.ts`
2. Import description from grep.txt
3. Define Zod schema: pattern (required), path, include
4. Implement regex search
5. Filter by file type with include
6. Return file paths and line numbers
7. Sort by modification time

#### Verification
- [ ] Regex search works
- [ ] File filtering works
- [ ] Line numbers accurate
- [ ] Results sorted

---

### Task 5.8: Bash Tool

**Prerequisites:** Task 5.1, Task 5.2
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement command execution with safety checks.

#### Before
```
src/tools/
└── grep.ts
```

#### After
```
src/tools/
├── grep.ts
└── bash.ts
```

#### Steps
1. Create `src/tools/bash.ts`
2. Import description from bash.txt
3. Define Zod schema: command, description, workdir, timeout
4. Execute via Bun shell or child_process
5. Capture stdout and stderr
6. Enforce timeout (default 2 min)
7. Support working directory parameter

#### Verification
- [ ] Commands execute
- [ ] Output captured
- [ ] Timeout enforced
- [ ] workdir works

---

### Task 5.9: Todo Data Model

**Prerequisites:** Task 1.3, Task 1.5
**Dependencies:** zod
**Estimated Effort:** Small

#### Description
Implement todo data model and storage operations.

#### Before
```
src/
└── session/ (empty or missing)
```

#### After
```
src/
└── session/
    └── todo.ts
```

#### Steps
1. Create `src/session/todo.ts`
2. Define TodoSchema with Zod:
   - id: string
   - content: string
   - status: enum (pending, in_progress, completed, cancelled)
   - priority: enum (high, medium, low)
3. Implement Todo.update() - writes to storage, publishes event
4. Implement Todo.get() - reads todos for session
5. Use storage key: ["todo", sessionID]

#### Verification
- [ ] Schema validates correctly
- [ ] Update persists and publishes
- [ ] Get retrieves todos
- [ ] Empty list for new sessions

---

### Task 5.10: TodoWrite Tool

**Prerequisites:** Task 5.1, Task 5.2, Task 5.9
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement tool for updating todo list.

#### Before
```
src/tools/
└── bash.ts
```

#### After
```
src/tools/
├── bash.ts
└── todo-write.ts
```

#### Steps
1. Create `src/tools/todo-write.ts`
2. Import description from todo-write.txt
3. Define Zod schema: todos (array of Todo)
4. Call Todo.update() to persist
5. Return count of non-completed todos
6. Include result metadata with todos

#### Verification
- [ ] Todos persist
- [ ] Event published
- [ ] Count returned
- [ ] Validation works

---

### Task 5.11: TodoRead Tool

**Prerequisites:** Task 5.1, Task 5.2, Task 5.9
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement tool for reading todo list.

#### Before
```
src/tools/
└── todo-write.ts
```

#### After
```
src/tools/
├── todo-write.ts
└── todo-read.ts
```

#### Steps
1. Create `src/tools/todo-read.ts`
2. Import description from todo-read.txt
3. Define Zod schema: empty object (no params)
4. Call Todo.get() to retrieve
5. Return todos as JSON
6. Return empty array if none

#### Verification
- [ ] Returns current todos
- [ ] Empty array for new session
- [ ] No parameters required

---

### Task 5.12: Task Tool (Subagent Launcher)

**Prerequisites:** Task 5.1, Task 5.2
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement tool for launching subagents.

#### Before
```
src/tools/
└── todo-read.ts
```

#### After
```
src/tools/
├── todo-read.ts
└── task.ts
```

#### Steps
1. Create `src/tools/task.ts`
2. Import description from task.txt
3. Define Zod schema: prompt, description, subagent_type
4. Route to explore or general subagent
5. Return subagent result
6. Handle subagent errors

#### Verification
- [ ] Launches subagents
- [ ] Returns results
- [ ] Errors handled

---

### Task 5.13: Agent Orchestrator

**Prerequisites:** Task 5.1 through 5.12
**Dependencies:** None
**Estimated Effort:** Large

#### Description
Create agent coordination system.

#### Before
```
src/
└── tools/
```

#### After
```
src/
├── tools/
└── agent/
    ├── index.ts
    └── orchestrator.ts
```

#### Steps
1. Create `src/agent/orchestrator.ts`
2. Route messages to appropriate agent based on mode
3. Handle tool call requests from LLM
4. Execute tools and return results
5. Manage agent state (thinking, generating)
6. Handle errors and retries
7. Create `src/agent/index.ts` with re-exports

#### Verification
- [ ] Routes to correct agent
- [ ] Tool calls executed
- [ ] Errors handled
- [ ] State tracked

---

### Task 5.14: Subagents

**Prerequisites:** Task 5.13
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement explore and general subagents.

#### Before
```
src/agent/
├── index.ts
└── orchestrator.ts
```

#### After
```
src/agent/
├── index.ts
├── orchestrator.ts
├── build.ts
├── explore.ts
└── general.ts
```

#### Steps
1. Create `src/agent/build.ts` - primary agent with all tools
2. Create `src/agent/explore.ts` - read-only tools (grep, glob, read)
3. Create `src/agent/general.ts` - most tools except todo
4. Implement agent-controlled delegation logic
5. Build agent decides when to delegate

#### Verification
- [ ] Build has all tools
- [ ] Explore is read-only
- [ ] General excludes todo
- [ ] Delegation works

---

## Phase 6: Session Management

> Persistence, checkpoints, commands

---

### Task 6.1: Session Store

**Prerequisites:** Task 1.3, Task 1.5
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement session persistence with auto-save.

#### Before
```
src/session/
└── todo.ts
```

#### After
```
src/session/
├── todo.ts
└── store.ts
```

#### Steps
1. Create `src/session/store.ts`
2. Save sessions to `~/.config/glm-cli/storage/session/`
3. Use JSON format with metadata
4. Implement auto-save every 30 seconds
5. Load existing sessions on startup
6. Handle concurrent access with locking

#### Verification
- [ ] Sessions save correctly
- [ ] Auto-save triggers
- [ ] Sessions load on startup
- [ ] No data corruption

---

### Task 6.2: Checkpoint System

**Prerequisites:** Task 6.1
**Dependencies:** git
**Estimated Effort:** Medium

#### Description
Implement git-based per-message checkpoints.

#### Before
```
src/session/
├── todo.ts
└── store.ts
```

#### After
```
src/session/
├── todo.ts
├── store.ts
└── checkpoint.ts
```

#### Steps
1. Create `src/session/checkpoint.ts`
2. Create checkpoint after each assistant message
3. Use git stash with message ID
4. Store checkpoint reference in session
5. Implement restore to checkpoint
6. Support redo after undo

#### Verification
- [ ] Checkpoints created
- [ ] Undo restores state
- [ ] Redo works after undo
- [ ] References tracked

---

### Task 6.3: Auto-Compact

**Prerequisites:** Task 6.1, Task 1.8
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement automatic context compaction at 70%.

#### Before
```
src/session/
├── todo.ts
├── store.ts
└── checkpoint.ts
```

#### After
```
src/session/
├── todo.ts
├── store.ts
├── checkpoint.ts
└── compact.ts
```

#### Steps
1. Create `src/session/compact.ts`
2. Monitor context usage percentage
3. Trigger at 70% threshold
4. Use AI to summarize conversation
5. Preserve key context and decisions
6. Show notification to user
7. Update session with compacted history

#### Verification
- [ ] Triggers at 70%
- [ ] Summary preserves key info
- [ ] Notification shown
- [ ] Session updated

---

### Task 6.4: Session Manager

**Prerequisites:** Task 6.1, Task 6.2, Task 6.3
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Create session lifecycle management.

#### Before
```
src/session/
├── todo.ts
├── store.ts
├── checkpoint.ts
└── compact.ts
```

#### After
```
src/session/
├── todo.ts
├── store.ts
├── checkpoint.ts
├── compact.ts
└── manager.ts
```

#### Steps
1. Create `src/session/manager.ts`
2. Implement new session creation
3. Implement session loading
4. Implement session switching
5. Handle cleanup on exit
6. Generate session end summary

#### Verification
- [ ] New sessions created
- [ ] Loading works
- [ ] Switching works
- [ ] Exit summary shown

---

### Task 6.5: Command Registry

**Prerequisites:** Phase 2 complete
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Create command registration system.

#### Before
```
src/
└── (no commands/)
```

#### After
```
src/
└── commands/
    ├── index.ts
    └── registry.ts
```

#### Steps
1. Create `src/commands/registry.ts`
2. Define Command interface with name, handler, description
3. Implement register() and execute() methods
4. Parse command arguments
5. Provide tab completion support
6. Create `src/commands/index.ts` with re-exports

#### Verification
- [ ] Commands register
- [ ] Arguments parsed
- [ ] Tab completion works
- [ ] Unknown commands handled

---

### Task 6.6: Core Commands

**Prerequisites:** Task 6.5, Task 6.4
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement /new, /save, /load, /quit, /exit commands.

#### Before
```
src/commands/
├── index.ts
└── registry.ts
```

#### After
```
src/commands/
├── index.ts
├── registry.ts
├── new.ts
├── save.ts
├── load.ts
└── quit.ts
```

#### Steps
1. Create `src/commands/new.ts` - prompt to save, create new
2. Create `src/commands/save.ts` - AI-generated name
3. Create `src/commands/load.ts` - session picker overlay
4. Create `src/commands/quit.ts` - show summary, exit
5. Register all commands

#### Verification
- [ ] /new prompts to save
- [ ] /save uses AI name
- [ ] /load shows picker
- [ ] /quit shows summary

---

### Task 6.7: Utility Commands

**Prerequisites:** Task 6.5, Task 6.2, Task 6.3
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement /undo, /redo, /compact, /model, /mode, /think commands.

#### Before
```
src/commands/
└── ... (core commands)
```

#### After
```
src/commands/
├── ... (core commands)
├── undo.ts
├── redo.ts
├── compact.ts
├── model.ts
├── mode.ts
└── think.ts
```

#### Steps
1. Create `src/commands/undo.ts` - revert to checkpoint
2. Create `src/commands/redo.ts` - restore undone
3. Create `src/commands/compact.ts` - manual summarization
4. Create `src/commands/model.ts` - model picker overlay
5. Create `src/commands/mode.ts` - mode picker overlay
6. Create `src/commands/think.ts` - toggle thinking
7. Register all commands

#### Verification
- [ ] /undo reverts
- [ ] /redo restores
- [ ] /compact triggers
- [ ] /model shows picker
- [ ] /mode shows picker
- [ ] /think toggles

---

### Task 6.8: Info Commands

**Prerequisites:** Task 6.5
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Implement /stats, /help, /config, /instruct commands.

#### Before
```
src/commands/
└── ... (utility commands)
```

#### After
```
src/commands/
├── ... (utility commands)
├── stats.ts
├── help.ts
├── config.ts
└── instruct.ts
```

#### Steps
1. Create `src/commands/stats.ts` - session statistics
2. Create `src/commands/help.ts` - categorized help overlay
3. Create `src/commands/config.ts` - settings overlay
4. Create `src/commands/instruct.ts` - instruction editor
5. Register all commands

#### Verification
- [ ] /stats shows stats
- [ ] /help shows help
- [ ] /config shows settings
- [ ] /instruct opens editor

---

## Phase 7: Polish + Release

> Final touches and release preparation

---

### Task 7.1: Error Handling Polish

**Prerequisites:** Phases 1-6 complete
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Comprehensive error handling review and improvement.

#### Steps
1. Audit all API error paths
2. Ensure user-friendly error messages
3. Implement retry dialogs
4. Catch all uncaught exceptions
5. Add error boundaries in UI

#### Verification
- [ ] All API errors handled
- [ ] Messages user-friendly
- [ ] Retry dialogs work
- [ ] No uncaught exceptions

---

### Task 7.2: Performance Optimization

**Prerequisites:** Phases 1-6 complete
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Profile and optimize critical paths.

#### Steps
1. Profile streaming performance
2. Optimize render batching (16ms target)
3. Measure input latency
4. Optimize startup time
5. Check memory usage

#### Verification
- [ ] Streaming at 60fps
- [ ] Input latency < 50ms
- [ ] Startup < 2 seconds
- [ ] Memory < 100MB idle

---

### Task 7.3: 16ms Event Batching

**Prerequisites:** Task 7.2
**Dependencies:** solid-js
**Estimated Effort:** Small

#### Description
Implement event batching utility for flicker-free updates.

#### Before
```
src/util/
└── ... (existing utils)
```

#### After
```
src/util/
├── ... (existing utils)
└── batch.ts
```

#### Steps
1. Create `src/util/batch.ts`
2. Batch events within 16ms window
3. Use solid-js batch() for coalesced updates
4. Make interval configurable
5. Ensure no dropped events

#### Verification
- [ ] 16ms batching works
- [ ] No dropped events
- [ ] Configurable interval
- [ ] Streaming smooth

---

### Task 7.4: Accessibility Review

**Prerequisites:** Phases 1-6 complete
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Ensure terminal accessibility standards.

#### Steps
1. Check color contrast ratios
2. Ensure keyboard-only navigation
3. Avoid color-only indicators
4. Test with screen readers if possible

#### Verification
- [ ] Contrast sufficient
- [ ] Keyboard navigation complete
- [ ] No color-only indicators
- [ ] Accessible to all users

---

### Task 7.5: Testing

**Prerequisites:** Phases 1-6 complete
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Implement critical path tests.

#### Steps
1. Write API client tests
2. Write tool execution tests
3. Write session persistence tests
4. Write command handler tests
5. Set up CI pipeline

#### Verification
- [ ] API tests pass
- [ ] Tool tests pass
- [ ] Session tests pass
- [ ] Command tests pass

---

### Task 7.6: Release Preparation

**Prerequisites:** Tasks 7.1-7.5
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Prepare for initial v0.1.0 release.

#### Steps
1. Set version to 0.1.0 in package.json
2. Create CHANGELOG.md
3. Ensure npm publish ready
4. Draft GitHub release notes
5. Update README with final content

#### Verification
- [ ] Version set correctly
- [ ] CHANGELOG complete
- [ ] npm publish works
- [ ] GitHub release drafted

---

## Dependency Graph

```
Phase 1 (Foundation)
    │
    ▼
Phase 2 (Core UI + Modes)
    │
    ├───────────────┬───────────────┐
    ▼               ▼               │
Phase 3         Phase 4             │
(MCP)           (Input)             │
    │               │               │
    └───────┬───────┘               │
            ▼                       │
      Phase 5 (Agent & Tools) ◄─────┘
            │
            ▼
      Phase 6 (Session Management)
            │
            ▼
      Phase 7 (Polish + Release)
            │
            ▼
      Phase 8 (Integration Wiring)
```

**Notes:**
- Phases 3 and 4 can run in parallel after Phase 2
- Phase 5 depends on Phases 3 and 4 for MCP tools and input handling
- Phase 6 depends on Phase 5 for agent integration
- Phase 7 is final polish after all features complete
- **Phase 8** was discovered during testing - it wires all infrastructure together in App.tsx

---

## Phase 8: Integration Wiring

> Wire all infrastructure together in App.tsx - discovered during testing

**Background:** Phases 1-7 created all the infrastructure (API client, UI components, contexts, session management, tools, commands) but App.tsx was never wired up to use them. The app showed hardcoded placeholder data instead of being functional. This phase connects everything.

---

### Task 8.1: Context Provider Integration

**Prerequisites:** Phases 1-7 complete
**Dependencies:** None
**Estimated Effort:** Small

#### Description
Wrap App.tsx with all required context providers.

#### Before
```tsx
// App.tsx renders components without contexts
function App() {
  return <box>...</box>
}
```

#### After
```tsx
// App.tsx wrapped with all providers
function App() {
  return (
    <ModeProvider>
      <SessionProvider>
        <TodoProvider>
          {/* App content */}
        </TodoProvider>
      </SessionProvider>
    </ModeProvider>
  )
}
```

#### Steps
1. Import ModeProvider from `src/ui/context/mode.tsx`
2. Import SessionProvider from `src/ui/context/session.tsx`
3. Import TodoProvider from `src/ui/context/todo.tsx`
4. Wrap root component with providers in correct order
5. Verify contexts are accessible in child components

#### Verification
- [ ] ModeProvider wraps app
- [ ] SessionProvider wraps app
- [ ] TodoProvider wraps app
- [ ] useMode() works in children
- [ ] useSession() works in children
- [ ] useTodo() works in children

---

### Task 8.2: API Key Check and Welcome Screen

**Prerequisites:** Task 8.1
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Check for API key on startup and show appropriate screen.

#### Before
```tsx
// App always shows session view
function App() {
  return <SessionView />
}
```

#### After
```tsx
// App checks API key, shows welcome or prompt
function App() {
  const [hasApiKey, setHasApiKey] = createSignal(false)
  const [messages] = useSession().messages
  
  return (
    <Show when={!hasApiKey()}>
      <ApiKeyPrompt onSave={...} />
    </Show>
    <Show when={hasApiKey() && messages().length === 0}>
      <WelcomeScreen />
    </Show>
    <Show when={hasApiKey() && messages().length > 0}>
      <SessionView />
    </Show>
  )
}
```

#### Steps
1. Load config using `load()` from `src/util/config.ts`
2. Check if apiKey exists (now optional in schema)
3. If no API key: show prompt overlay to enter one
4. Save API key to config file when entered
5. If API key exists but no messages: show WelcomeScreen
6. If API key exists and has messages: show SessionView

#### Verification
- [ ] Missing API key shows prompt
- [ ] Entered API key saves to config
- [ ] New session shows welcome screen
- [ ] Existing session shows chat view

---

### Task 8.3: Input Submission to GLMClient

**Prerequisites:** Task 8.2
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Connect InputArea submission to GLMClient for actual API calls.

#### Before
```tsx
// Input submission does nothing
<InputArea onSubmit={(text) => console.log(text)} />
```

#### After
```tsx
// Input submission sends to GLMClient and streams response
<InputArea onSubmit={async (text) => {
  addMessage({ role: "user", content: text })
  const stream = await client.chat(messages())
  // Handle stream...
}} />
```

#### Steps
1. Initialize GLMClient with API key from config
2. On input submit: add user message to session
3. Build messages array for API call
4. Call GLMClient.chat() with streaming enabled
5. Create StreamProcessor to handle SSE chunks
6. Update assistant message as chunks arrive
7. Handle thinking content separately
8. Handle tool calls when present

#### Verification
- [ ] User message added to session
- [ ] API call made with messages
- [ ] Streaming response updates UI
- [ ] Thinking content extracted
- [ ] Tool calls processed

---

### Task 8.4: Session Manager Integration

**Prerequisites:** Task 8.3
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
Wire up SessionManager for persistence and lifecycle.

#### Before
```tsx
// Session state in memory only
const [messages, setMessages] = createSignal([])
```

#### After
```tsx
// Session state persisted via SessionManager
const session = useSession()
// Auto-saves, loads on startup, supports /new, /load, /save
```

#### Steps
1. Initialize SessionManager on app startup
2. Load existing session if available
3. Wire auto-save (30 second interval)
4. Connect session context to SessionManager
5. Ensure messages persist across restarts
6. Wire up /new, /load, /save commands

#### Verification
- [ ] Sessions persist to disk
- [ ] Auto-save triggers every 30s
- [ ] App loads last session on startup
- [ ] /new creates fresh session
- [ ] /load opens session picker
- [ ] /save persists current session

---

### Task 8.5: Final Integration Testing

**Prerequisites:** Tasks 8.1-8.4
**Dependencies:** None
**Estimated Effort:** Medium

#### Description
End-to-end testing of the integrated application.

#### Steps
1. Run typecheck: `bun run typecheck`
2. Run tests: `bun test`
3. Run build: `bun run build`
4. Manual test: start app, enter API key, send message
5. Verify streaming response renders
6. Verify tool calls work
7. Verify session saves and loads
8. Verify all keyboard shortcuts work
9. Test all slash commands

#### Verification
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Build succeeds
- [ ] App starts without crash
- [ ] API key prompt works
- [ ] Messages stream correctly
- [ ] Tools execute and display results
- [ ] Sessions persist
- [ ] Mode switching works (Tab)
- [ ] Commands work (/new, /quit, etc.)

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [Requirements.md](Requirements.md) | What to build |
| [Design.md](Design.md) | How it's architected |
| [specs/tool-descriptions.md](specs/tool-descriptions.md) | Tool prompt content |
| [specs/event-bus.md](specs/event-bus.md) | Event system details |
| [specs/storage.md](specs/storage.md) | Storage module details |
