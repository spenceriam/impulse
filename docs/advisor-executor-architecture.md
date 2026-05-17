# Plan: Impulse Advisor/Executor Architecture

Full implementation of the Advisor/Executor pattern — a client-side orchestration pairing a fast executor model with a stronger advisor model.

---

## 1. Activation & Configuration Gating

### /advisor Command Flow

```
/advisor → toggle ON/OFF

OFF → ON:
  1. Load config. Check if advisorModel is set.
  2. If configured: "Current Advisor: X via Y. Change? (y/N)"
  3. If NOT configured: force setup → pick → model → reasoning → activate
  4. Inject "Advisor Mode" directive into Main Agent's system prompt

ON → OFF:
  1. Remove advisorModel from config
  2. Clear Advisor Mode directive from system prompt
  3. Context bar: no advisor segment
```

### Config Fields
- `advisorModel` (existing): full model string
- `advisorMode` (NEW): boolean — is advisor mode active

---

## 2. The Main Agent — "Visa" Hard Tool Gate

### Gate Logic
When advisor mode ON, AgentLoop enforces:
- Tools BLOCKED before consult_advisor: `file_write`, `file_edit`, `bash` (write), `task`, `todo_write`
- Tools ALLOWED: `read_file`, `glob`, `grep`, `bash` (read-only), `todo_read`, `web_search`, `web_fetch`, `set_header`, `set_mode`
- After consult_advisor returns → gate opens for rest of turn

### System Prompt Injection
```
## Advisor Mode (ACTIVE)
MANDATORY: Call consult_advisor before any file writes, edits, bash execution, or subagent launches.
If you encounter errors: DO NOT GUESS. Re-consult advisor with error context.
```

---

## 3. consult_advisor Tool

### Tool Schema
```typescript
{
  name: "consult_advisor",
  parameters: {
    topic: string,          // Brief topic for filename
    context: string,        // Full context
    type: "plan" | "advisory"  // Plan = strategic, Advisory = corrective
  }
}
```

### Execution Flow

1. Main Agent calls `consult_advisor(topic, context, type)`
2. AgentLoop intercepts the tool call, creates tool block in chat:
   ```
   ●·· consult_advisor  "refactor auth module"
        Consulting Opus 4.7 via OpenRouter
   ```
3. One-line status above prompt shows: `...advisor working...` (grayscale shimmer)
4. Impulse builds advisor prompt from full session context
5. API call to advisor model via provider manager
6. On SUCCESS:
   - Validate plan structure (required sections + self-check)
   - Write to `.impulse/advisor-plans/[type]-[topic]-[timestamp].md`
   - Update tool block to completed state:
     ```
     ✓ consult_advisor  "refactor auth module"  [OK]  3.2s
          Consulting Opus 4.7 via OpenRouter

       ✓ Plan saved to .impulse/advisor-plans/plan-refactor-auth-module.md
          Summary: JWT-based auth with refresh token rotation, session store in Redis
     ```
   - Return JSON to Main Agent: `{ summary, plan_path, advisor_model, self_check_passed }`
   - Status line reverts to normal main agent phrase

7. On FAILURE:
   - Show raw API error underneath the "Consulting..." line:
     ```
     ✗ consult_advisor  "refactor auth module"  [FAIL]  30.0s
          Consulting Opus 4.7 via OpenRouter

          Error: API request timed out after 30000ms
     ```
   - Status line reverts to normal main agent phrase
   - Overlay appears: "Retry / Reconfigure / Cancel"

### Plan File Format
```markdown
# Advisor [Plan | Advisory]: [topic]
**Date:** 2026-05-14 14:30:22
**Advisor:** claude-opus-4.7 via openrouter
**Executor:** deepseek-v4-pro via ollama
**Type:** plan

## Goals
## Approach
## Task List
- [ ] Task — description
## Dependencies
## Risks
## Self-Check
- [x] All sections present
- [x] Task list actionable
- [x] Dependencies identified
```

---

## 4. Execution & Feedback Loop

### Plan Approval
1. Main Agent reads plan file
2. Summarizes plan in chat
3. PERMISSION OVERLAY: "Proceed with plan?" with options (Execute, Review, Decline)

### Failure Protocol
1. Error occurs → Main Agent summarizes failure
2. Calls consult_advisor(type: "advisory", context: "[error + stack trace + what was tried]")
3. Advisor writes `advisory-[topic]-timestamp.md` (separate file — doesn't pollute original plan)
4. Main Agent reads advisory, applies fix
5. 2 rounds max → halt, ask user

---

## 5. Edge Cases

### Provider Unreachable (Timeout / Auth Failure)
- If the advisor API call fails (timeout, 401, 429, network error):
  1. TUI shows the error in the tool result
  2. PERMISSION OVERLAY: "Advisor unavailable: [reason]"
     Options: "Retry" / "Reconfigure" / "Cancel"
  3. Cancel opens the tool gate for this turn only — main agent continues without advice
  4. Retry re-sends the same request to the advisor
  5. Reconfigure opens mini setup to change advisor model/provider

### User Abort During Consultation
- If user presses Esc while `consult_advisor` is in-flight:
  1. Send `AbortSignal` to provider API call
  2. Provider may or may not respect it — if response arrives later, discard it
  3. No plan file written — clean break
  4. Main agent notified: "Advisor consultation cancelled"
  5. Gate remains closed — main agent still must consult before executing
  6. User can retry or toggle advisor OFF

### Mid-Turn Advisor Config Validation
- At turn START, if `advisorMode` ON:
  - Check that advisorModel is set AND provider has API key + endpoint
  - If missing/invalid: show overlay with options to fix
  - Options: "Reconfigure" / "Cancel request" (Esc also dismisses)
  - This catches edge cases like manually broken config.json or expired credentials

### Consultation Status Display

Two separate visual indicators during `consult_advisor`:

**1. One-line status above prompt (shimmer):**
```
...advisor working...
```
- Grayscale shimmer: ANSI 234 base → 244 adjacent → 248 peak + bold
- Replaces the main agent's normal status phrase during consultation
- Reverts to normal phrase when advisor call completes or fails

**2. Tool block row inside chat history:**
- Running:
  ```
  ●·· consult_advisor  "refactor auth module"
       Consulting Opus 4.7 via OpenRouter
  ```
  The "Consulting..." line shimmers with 3-dot spinner

- Completed:
  ```
  ✓ consult_advisor  "refactor auth module"  [OK]  3.2s
       Consulting Opus 4.7 via OpenRouter

    ✓ Plan saved to .impulse/advisor-plans/plan-refactor-auth-module.md
       Summary: JWT-based auth with refresh token rotation...
  ```
  "Consulting..." line becomes static, plan path and summary shown below

- Failed (API error shown verbatim):
  ```
  ✗ consult_advisor  "refactor auth module"  [FAIL]  30.0s
       Consulting Opus 4.7 via OpenRouter

       Error: API request timed out after 30000ms
  ```

  Other failure examples:
  ```
       Error: 429 Too Many Requests — rate limit exceeded. Retry after 15s.
       Error: 400 Prompt too long — input tokens (215,432) exceed model maximum (200,000).
       Error: 401 Invalid API key — check your OpenRouter credentials.
       Error: Network error — unable to connect to api.openrouter.ai (ENOTFOUND)
  ```

### Auto-Off Suggestion
- Trigger: Main Agent detects ALL tasks from the advisor plan are completed AND no errors remain
- Timing: At end of turn, AFTER all tool results are shown
- PERMISSION OVERLAY:
  Title: "Strategy Complete"
  Body: [Main Agent's reasoning for why advisor mode is no longer needed — contextual explanation so user makes informed decision]
  Options: "Keep ON" / "Deactivate"
- If user is idle or doesn't respond, overlay remains (doesn't auto-dismiss)
- Not a mid-turn interruption — clean end-of-turn reminder

### Project Session Resume (Future Enhancement — NOT in this plan)
- Session resume with advisor state is a separate future feature
- When sessions support `/continue`, advisor mode state will persist with the session
- `.impulse/advisor-plans/` timestamped files will be discoverable by the resumed session
- NOT part of the current implementation

---

## 6. Files

### New
- `src/agent/advisor.ts` — runAdvisor, validatePlan, savePlan, buildPrompt

### Modified
- `src/agent/loop.ts` — Tool gate, consult_advisor handler, circular logic detection
- `src/cli/renderer.ts` — Plan approval overlay, auto-off overlay, activation flow
- `src/util/config.ts` — advisorMode field
- `src/tools/registry.ts` — Tool gate filter

---

## 7. Implementation Order
1. Config + activation flow
2. Tool gate enforcement
3. consult_advisor tool + advisor.ts module
4. Permission overlay for plan approval
5. Failure protocol + circular logic detection
6. Auto-off overlay
7. Edge cases (timeout, re-entry)

---

## 8. Verification
- typecheck, tests pass
- `/advisor` activation flow with config check
- Tool gate blocks writes until consultation
- Plan files written with all sections + self-check
- Overlay asks for approval before execution
- Advisory files for error recovery
- Auto-off overlay on completion
