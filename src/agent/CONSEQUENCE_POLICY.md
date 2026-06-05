# Token Budget Margin & Threshold Policy

## Why a 15% Hard Margin?

- Estimation is approximate: exact token counts differ across providers, tool-execution output varies, and stream turns arrive at unpredictable sizes.
- We reserve a 15% hard margin (`Math.ceil(estimate * 1.15)`) to absorb those uncertainties.
- If the safety-adjusted estimate still exceeds the context window, we trigger an **emergency compact** (forces compaction) and fall back to a hard cutoff that skips the API request entirely.

## Why Keep the 50/30 Thresholds?

The existing thresholds remain but are **now safe by margin**:

- **50% early trigger**: Starts compacting at half capacity. Because the margin is already reserved, the system never exceeds the real limit even with estimation error.
- **30% residual floor**: Prevents over-aggressive compaction on tiny histories.

In practice, the early trigger usually keeps actual usage well below the hard ceiling. The margin provides a safety net rather than a new primary control.

## Hard Cutoff Behavior

If, after both normal and emergency compaction, the final estimate still exceeds `contextWindow`:
1. A system message is injected with diagnostics and actionable suggestions (`/compact` or `/new`).
2. The loop exits: **no API request is made**.
3. `onHardCutoff()` is emitted for UI notification.

## References

- Emitted event: `LoopEvent` (see `events.onHardCutoff()` in `loop.ts`)
- Related modules: `src/agent/loop.ts`, `src/agent/compact.ts`
