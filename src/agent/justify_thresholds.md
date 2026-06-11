# Token Budget Margin & Threshold Policy

## Current Thresholds

| Parameter | Value | Location |
|-----------|-------|----------|
| COMPACT_WARNING_THRESHOLD | 0.50 (50%) | `src/session/compact.ts` |
| COMPACT_TRIGGER_THRESHOLD | 0.60 (60%) | `src/session/compact.ts` |
| CONTEXT_WRAPUP_THRESHOLD | 0.80 (80%) | `src/session/compact.ts` |
| Safety margin multiplier | 1.15x | `src/session/compact.ts` (`SAFETY_MARGIN`) |

## Why a 15% Hard Margin Is Still Needed

- Estimation is approximate: exact token counts differ across providers, tool-execution output varies, and stream turns arrive at unpredictable sizes.
- We reserve a 15% hard margin (`Math.ceil(estimate * SAFETY_MARGIN)`) to absorb those uncertainties.
- If the safety-adjusted estimate still exceeds the context window, we trigger an **emergency compact** (forces compaction) and fall back to a hard cutoff that skips the API request entirely.

## Why Keep the 60% Auto-Compact Threshold

The 60% trigger starts compaction before the context bar turns red (60%+). The 80% wrap-up inject nudges the model to finish concisely. The 15% margin provides a safety net on the final gate.

## Hard Cutoff Behavior

If, after both normal and emergency compaction, the safety-adjusted final estimate still exceeds `contextWindow`:

1. The loop exits: **no API request is made**.
2. `onHardCutoff()` is emitted for UI notification (single user-visible message — no duplicate system message).

## References

- Emitted event: `LoopEvents.onHardCutoff()` in `src/agent/loop.ts`
- Related modules: `src/agent/loop.ts`, `src/session/compact.ts`
