# Flicker Analysis — Codex CLI Investigation

> Branch: `fix/flicker-and-slash-aliases-110-109`
> Issue: [#110](https://github.com/spenceriam/impulse/issues/110)
> Date: 2026-06-10

## Current State of the PR Branch

- `/aa` and other aliases are fixed via canonicalization.
- Startup terminal clear is added.
- `PI_DEBUG_REDRAW=1` no longer crashes because we create `~/.pi/agent`.
- Render debug instrumentation exists via `IMPULSE_RENDER_DEBUG=1`.
- The experiment that removed shimmer/todo blink was reverted, so the old UI feel is restored.
- `mcps/` remains untracked and unrelated.

### Relevant Commits

```
54983fc Revert "fix(cli): remove shimmer and todo blink redraw triggers"
ed52c7a fix(cli): create pi-tui redraw debug directory
0cde308 fix(cli): canonicalize slash aliases and clear TUI startup
```

We're back to preserving UX while investigating architecture.

---

## Root Cause (from captured logs)

```
pi-tui: fullRender: firstChanged < viewportTop (451 < 465)
impulse: render full-redraw phase=status_tick
```

1. Impulse requests a render, usually from the status shimmer tick.
2. pi-tui renders the full component tree to compare old/new lines.
3. The earliest changed line is above the visible viewport.
4. pi-tui cannot safely differentially update that offscreen line.
5. pi-tui falls back to full redraw.
6. User sees the "alternate chat flashes for a split second" flicker.

**Key nuance:** `status_tick` is the trigger; the changed line may be an offscreen tool/todo/task block whose render output depends on time.

Examples in current code:
- `shimmerText(...)` uses `Date.now()`.
- Todo blink uses `TODO_BLINK_PHASE_MS` and `Date.now()`.
- Running tool/task spinners use `Date.now()`.
- Running task elapsed suffix uses `Date.now()`.

**Root cause:** Animations live inside the same full scrollback render tree as old chat history. Once an animated line scrolls above the viewport, every render tick can cause `firstChanged < viewportTop`.

---

## Current pi-tui Capabilities

Impulse uses `@mariozechner/pi-tui` ^0.73.0 (installed: 0.73.1).

The package provides a component model, differential rendering, and synchronized output using CSI 2026 — the right primitives for flicker-free terminal UIs. The failure mode is pi-tui's safety fallback: when the first changed rendered line is above the current viewport, it full-renders. Impulse must keep offscreen history stable.

Pi has moved package scopes: old `@mariozechner/pi-tui` maps to `@earendil-works/pi-tui`. 0.73.1 is the final old-scope release; 0.74.0+ continues under `@earendil-works`. A dependency migration is a separate investigation, not part of this PR.

---

## What Other CLIs Suggest Architecturally

### Codex CLI (OpenAI)
Rust-based TUI using crossterm and ratatui, with scrolling regions and rendered-line info. The TUI owns the visible viewport and can reason about scroll regions/cells, rather than re-rendering a giant mutable scrollback as one line array.

### Grok CLI
Built with Bun and OpenTUI. OpenTUI describes a component-based architecture focused on correctness, stability, and high performance.

**Lesson:** Separate committed history from active mutable UI. Not "rewrite in another TUI."

---

## Design Options (Preserving UX)

### Option 1 — Commit Old Blocks into Static Snapshots

**Best first implementation.**

Keep live components while active. Once a block is no longer active, replace it with static rendered lines.

- Active ToolBlock: spinner, todo blink, elapsed time can animate.
- Completed ToolBlock: render once, then replace with static lines.
- Active assistant stream: mutable.
- Completed assistant message: static.

**Why:** Old history stops changing. If a block scrolls above the viewport, it can't produce `firstChanged < viewportTop`.

**Risks:** Historical expand/collapse becomes more complex. Mitigate by storing both collapsed and expanded snapshots, or replacing static snapshot with live component only on explicit expand.

---

### Option 2 — Freeze Animations When Offscreen

Keep live components, but only animate if their rendered range intersects the visible viewport.

- No todo blink, spinner frame advance, elapsed time suffix update for offscreen blocks.

**Why:** Offscreen animated blocks stop changing.

**Risks:** Measuring lines can call `render()`, which currently uses time. Need render measurement to be deterministic or cached.

**Verdict:** Good follow-up for long-running active tasks that scroll above viewport.

---

### Option 3 — ChatViewport Component

Instead of putting every chat child directly into root pi-tui, create a `ChatViewport` component that owns full history internally but only returns visible lines to pi-tui.

**Why:** Offscreen lines are not part of pi-tui's diff. They cannot be `firstChanged`.

**Risks:** Larger architectural change — manual scroll handling, auto-scroll, session replay, copy last response, block expansion, overlays/sidebars, prompt area sizing.

**Verdict:** Best long-term architecture, but likely too much for current PR.

---

### Option 4 — Active Animation Island

Move animated status/progress out of chat history and into a visible "active work" region:

```
[chat history, stable]
[active work / live tool / current todo / status shimmer]
[prompt]
[context bar]
```

**Why:** Animations happen in a visible region only, so first changed line is not above viewport.

**Risks:** Tool animation may no longer appear inline exactly where the tool was created. Mitigate with static placeholder in chat + live details block in active region.

**Verdict:** Strong option for preserving shimmer/status UX.

---

### Option 5 — Block-Level Cache + Dirty Flags

Make `render()` pure and cached. No hidden `Date.now()` inside render.

- Animation controller ticks visible/active blocks.
- Block marks itself dirty.
- Unchanged blocks return cached lines.

**Why:** A global status tick no longer makes every historical block produce new output.

**Risks:** Requires discipline across all components. pi-tui's `Component.render(width)` doesn't accept context, so render mode must be stored on components before calling `requestRender()`.

**Verdict:** Good internal architecture improvement. Could be paired with snapshots.

---

### Option 6 — Streaming Buffer / Coalescer

Buffer model tokens for 150–300ms and flush in batches. Flush immediately on: tool start, tool end, turn end, interrupt, thinking close.

**Why:** Reduces render churn, markdown rewrap churn, and CPU pressure.

**Why not sufficient alone:** Logs showed `status_tick`, not stream, as the repeated full-redraw phase. Buffering helps but does not solve offscreen animation by itself.

**Verdict:** Good supporting improvement after isolating history/animations.

---

### Option 7 — Fixed-Height Live Tool Cards

While tools are running, give each live tool card a stable bounded height (e.g., tool row + latest progress line + latest subagent line + latest summary line).

**Why:** Line indexes become more stable during active tool use.

**Verdict:** Good for subagents/tools, especially if task progress is verbose.

---

### Option 8 — Improve pi-tui's Fallback Behavior

If `firstChanged < viewportTop`, pi-tui could compare only the visible viewport slice:
- If visible slice is unchanged, update `previousLines` internally and skip terminal output.
- If visible slice changed, full redraw.

**Why:** Directly fixes the renderer's offscreen-change full-redraw issue.

**Why not first:** Avoid patching node_modules. Could be upstream PR, local fork, or migration to `@earendil-works/pi-tui` if already improved.

**Verdict:** Worth prototyping, not the immediate app-layer fix.

---

## Recommended Implementation Order

1. **Keep current debug instrumentation** — `PI_DEBUG_REDRAW`, `IMPULSE_RENDER_DEBUG`, phase logging, pi-tui debug dir creation.
2. **Static snapshots for completed blocks** (Option 1) — smallest architectural change that attacks root cause. Active blocks animate; completed/history blocks become static; offscreen history stops changing.
3. **Visibility gating for active animations** (Option 2) — if an active tool/task scrolls above viewport, freeze its animation. Covers long-running tasks.
4. **Streaming buffering** (Option 6) — 150–300ms flush cadence to reduce render pressure.
5. **ChatViewport as v2 architecture** (Option 3) — if flicker remains or for cleanest design.

---

## Next Experiment

Start with static snapshots for completed ToolBlock/todo blocks (highest-value, lowest-risk isolation step).

**Success criteria:**
- Shimmer remains.
- Todo blink remains for active/current todo.
- Old completed tool/todo blocks become static.
- Re-run long sanity prompt.
- `status_tick` may still occur, but repeated `firstChanged < viewportTop` should drop or disappear.

If it does, the fix direction is proven without sacrificing UX.
