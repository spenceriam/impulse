# Token Budget Margin & Threshold Policy

## Why a 15% Hard Margin?

- Estimation is approximate: exact token counts differ across providers, tool-execution output varies, and stream turns arrive at unpredictable sizes.
- We reserve a 15% hard margin (`Math.ceil(estimate * SAFETY_MARGIN)`) to absorb those uncertainties.
- If the safety-adjusted estimate still exceeds the context window, we trigger an **emergency compact** (forces compaction) and fall back to a hard cutoff that skips the API request entirely.

## Thresholds

| Parameter | Value | Purpose |
|-----------|-------|---------|
| COMPACT_TRIGGER_THRESHOLD | 60% | Auto-compact before each loop iteration |
| CONTEXT_WRAPUP_THRESHOLD | 80% | Steer-style wrap-up inject (once per turn) |
| SAFETY_MARGIN | 1.15 | Emergency compact + hard cutoff gate |

## Hard Cutoff Behavior

If, after both normal and emergency compaction, the safety-adjusted final estimate still exceeds `contextWindow`:

1. The loop exits: **no API request is made**.
2. `onHardCutoff()` is emitted for UI notification (single user-visible message).

## References

- Emitted event: `LoopEvents.onHardCutoff()` in `src/agent/loop.ts`
- Related modules: `src/agent/loop.ts`, `src/session/compact.ts`
