import { describe, expect, test } from "bun:test";
import path from "path";
import {
  QuietWorkGroupTracker,
  buildQuietRecapFact,
  classifyQuietOutcome,
  deriveIntentFromThinking,
  extractOpenPlanItem,
  fitQuietLiveLine,
  formatDuration,
  formatQuietLiveStatus,
  formatQuietRecap,
  formatQuietSubagentLine,
  formatQuietSubagentSettle,
  formatWorkedFor,
  humanizeWebFetchTarget,
  fullQuietArg,
  humanizeBashCommand,
  isQuietBreakOutcome,
  isVagueRecapNoun,
  lastFailureNextLabel,
  pickQuietRecapNext,
  quietThinkingPhrase,
  quietToolLabel,
  shortQuietArg,
  unansweredAskNextLabel,
  wrapQuietRecapLines,
  type QuietRecapEvent,
} from "../src/cli/quiet-status.js";

/** Strip SGR codes for text comparisons (badge ANSI rides codename lines). */
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("quiet-status", () => {
  test("templated tool verb + short arg", () => {
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "file_read", arg: "AGENTS.md" }],
      })
    ).toBe("Reading AGENTS.md");
  });

  test("live narration carries a ticking elapsed time", () => {
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "file_read", arg: "AGENTS.md" }],
        elapsedMs: 4_200,
      })
    ).toBe("Reading AGENTS.md (4s)");
    expect(
      formatQuietLiveStatus({
        thinking: "assessing",
        tools: [],
        elapsedMs: 340,
      })
    ).toBe("Thinking (340ms)");
  });

  test("intent phrase narrates the thinking phase", () => {
    expect(
      formatQuietLiveStatus({
        thinking: "assessing",
        thinkingIntent: "review the codebase and README",
        tools: [],
        elapsedMs: 2_000,
      })
    ).toBe("Reviewing the codebase and README (2s)");
    expect(
      formatQuietLiveStatus({
        thinking: "planning",
        thinkingIntent: "how to fix the wrap width",
        tools: [],
        elapsedMs: 3_000,
      })
    ).toBe("Fixing the wrap width (3s)");
    expect(
      formatQuietLiveStatus({
        thinking: "planning",
        thinkingIntent: "The repo uses a plugin architecture",
        tools: [],
        elapsedMs: 1_500,
      })
    ).toBe("Understanding the repo uses a plugin architecture (2s)");
  });

  test("long label truncates, elapsed suffix always survives (#161)", () => {
    // task descriptions are the honest long-label vehicle — bash labels are
    // humanized short by design (#164).
    const longDesc =
      "Review the quiet-status module and report every exported function with its signature";
    const line = formatQuietLiveStatus({
      tools: [{ id: "1", name: "task", arg: longDesc }],
      elapsedMs: 84_000,
      availableWidth: 80,
    });
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line.endsWith("(1 min 24s)")).toBe(true);
    expect(line).toContain("…");
    expect(line.startsWith("Reviewing the quiet-status module")).toBe(true);
  });

  test("failure count in the suffix survives truncation (#161)", () => {
    const longDesc = "deep-dive ".repeat(20).trim();
    const line = formatQuietLiveStatus({
      tools: [{ id: "1", name: "task", arg: longDesc }],
      elapsedMs: 84_000,
      failedCount: 2,
      availableWidth: 80,
    });
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line.endsWith("(1 min 24s, 2 failed)")).toBe(true);
  });

  test("suffix reserve is measured per render, not constant (#161)", () => {
    const arg = "x".repeat(70);
    const seconds = formatQuietLiveStatus({
      tools: [{ id: "1", name: "task", arg }],
      elapsedMs: 9_000,
      availableWidth: 80,
    });
    const minutes = formatQuietLiveStatus({
      tools: [{ id: "1", name: "task", arg }],
      elapsedMs: 61_000,
      availableWidth: 80,
    });
    expect(seconds.endsWith("(9s)")).toBe(true);
    expect(minutes.endsWith("(1 min 1s)")).toBe(true);
    // Same width, longer suffix → the label gives up exactly the difference.
    expect(minutes.length).toBeLessThanOrEqual(80);
  });

  test("parallel count stays inside the preserved suffix (#161)", () => {
    const line = formatQuietLiveStatus({
      tools: [
        { id: "1", name: "task", arg: "y".repeat(90) },
        { id: "2", name: "grep", arg: "needle" },
      ],
      elapsedMs: 3_000,
      availableWidth: 60,
    });
    expect(line.length).toBeLessThanOrEqual(60);
    expect(line.endsWith("(3s, +1 parallel)")).toBe(true);
  });

  test("undefined width keeps legacy no-truncation behavior", () => {
    const line = formatQuietLiveStatus({
      tools: [{ id: "1", name: "task", arg: "z".repeat(150) }],
      elapsedMs: 2_000,
    });
    expect(line).toBe(`Delegating ${"z".repeat(150)} (2s)`);
  });

  test("extremely narrow width degrades to suffix-only (#161)", () => {
    const line = formatQuietLiveStatus({
      tools: [{ id: "1", name: "task", arg: "w".repeat(60) }],
      elapsedMs: 84_000,
      availableWidth: 12,
    });
    expect(line).toBe("(1 min 24s)");
  });

  test("fitQuietLiveLine leaves fitting lines untouched", () => {
    expect(fitQuietLiveLine("Reading AGENTS.md", " (2s)", 80)).toBe(
      "Reading AGENTS.md (2s)"
    );
  });

  test("humanizeBashCommand: chained search collapses to intent + topic (#164)", () => {
    const chain =
      'cd /tmp && sleep 75 && grep -rn "quiet-status\\|midTurnSubmit\\|chatDensity\\|showRecap" ~/GitHub/impulse/src/cli ~/GitHub/impulse/src/agent --include=\'*.ts\' -l | head -20 && echo \'=== search complete ===\'';
    expect(humanizeBashCommand(chain)).toEqual({
      live: "Searching the code for 'quiet-status' and 3 more terms",
      done: "searched the code for 'quiet-status' and 3 more terms",
    });
  });

  test("humanizeBashCommand: the five #163 report commands never echo raw shell", () => {
    expect(humanizeBashCommand("gh repo view spenceriam/impulse 2>&1 | head -50").done).toBe(
      "viewed the repo on GitHub"
    );
    expect(humanizeBashCommand("gh release list -R spenceriam/impulse --limit 5").done).toBe(
      "checked releases on GitHub"
    );
    expect(humanizeBashCommand("gh api repos/spenceriam/impulse/readme").done).toBe(
      "read the README on GitHub"
    );
    expect(humanizeBashCommand("gh release view v1.11.0 -R spenceriam/impulse").done).toBe(
      "checked release v1.11.0 on GitHub"
    );
    expect(
      humanizeBashCommand('cd /tmp/impulse-review && echo "=== new files ===" && ls -la').done
    ).toBe("checked the folder contents");
  });

  test("humanizeBashCommand: git, tests, packages, scripts", () => {
    expect(humanizeBashCommand("cd /tmp/x && git log --oneline -20").live).toBe(
      "Reviewing recent commits"
    );
    expect(humanizeBashCommand("npm test 2>&1 | tail -30").live).toBe("Running the tests");
    expect(humanizeBashCommand("bun install zod").live).toBe("Installing zod");
    expect(humanizeBashCommand("npm run build").live).toBe("Running build");
    expect(humanizeBashCommand("npx rea-agents@latest setup").live).toBe("Running rea-agents@latest");
    expect(humanizeBashCommand("node scripts/build.ts").live).toBe("Running build.ts");
  });

  test("humanizeBashCommand: fallbacks stay honest without echoing args", () => {
    expect(humanizeBashCommand("terraform plan -out=tfplan")).toEqual({
      live: "Running terraform",
      done: "ran terraform",
    });
    expect(humanizeBashCommand("cd /tmp && sleep 5 && echo done")).toEqual({
      live: "Running a terminal command",
      done: "ran a terminal command",
    });
    expect(humanizeBashCommand("cat package.json | grep version").live).toBe(
      "Looking at package.json"
    );
    expect(humanizeBashCommand("curl -s https://api.github.com/repos/spenceriam/impulse").live).toBe(
      "Fetching a page from api.github.com"
    );
  });

  test("humanizeBashCommand: definitions and bare flags never read as commands (#180)", () => {
    // Function definitions are definitions, not invocations — never "ran stats(){}"
    expect(humanizeBashCommand("stats(){ echo hi; }")).toEqual({
      live: "Defining a function",
      done: "defined a function",
    });
    expect(humanizeBashCommand("function stats { echo hi; }")).toEqual({
      live: "Defining a function",
      done: "defined a function",
    });
    // Bare flags are not commands — never "ran -v" / "ran --verbose"
    expect(humanizeBashCommand("-v")).toEqual({
      live: "Running a terminal command",
      done: "ran a terminal command",
    });
    expect(humanizeBashCommand("sudo -v")).toEqual({
      live: "Running a terminal command",
      done: "ran a terminal command",
    });
  });

  test("live narration humanizes bash, keeps the suffix (#164)", () => {
    const line = formatQuietLiveStatus({
      tools: [
        {
          id: "1",
          name: "bash",
          arg: 'cd /tmp && sleep 75 && grep -rn "quiet-status\\|midTurnSubmit" src | head -20',
        },
      ],
      elapsedMs: 17_000,
      availableWidth: 120,
    });
    expect(line).toBe("Searching the code for 'quiet-status' and 1 more term (17s)");
  });

  test("vague task descriptions get a prompt-derived topic (#165)", () => {
    expect(
      fullQuietArg("task", {
        description: "Researching a website page",
        prompt: "Read https://github.com/morluto/rea and summarize what it does",
      })
    ).toBe("Researching github.com/morluto/rea");
    expect(
      fullQuietArg("task", {
        description: "Explore the codebase",
        prompt: "Look through src/cli/quiet-status.ts and report the exports",
      })
    ).toBe("Exploring quiet-status.ts");
    // No concrete topic available → description passes through unchanged
    expect(fullQuietArg("task", { description: "Check things", prompt: "look around" })).toBe(
      "Check things"
    );
  });

  test("specific task descriptions pass through untouched (#165)", () => {
    expect(
      fullQuietArg("task", {
        description: "Research the auth module",
        prompt: "Read src/auth/index.ts and report",
      })
    ).toBe("Research the auth module");
    expect(
      fullQuietArg("task", { description: "Review AGENTS.md sections", prompt: "…" })
    ).toBe("Review AGENTS.md sections");
  });

  test("gerund-led task labels drop the Delegating prefix (#165)", () => {
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "task", arg: "Researching github.com/morluto/rea" }],
        elapsedMs: 12_000,
      })
    ).toBe("Researching github.com/morluto/rea (12s)");
    // Imperative verb-led descriptions gerundize (no "Delegating" needed)
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "task", arg: "Research the auth module" }],
        elapsedMs: 4_000,
      })
    ).toBe("Researching the auth module (4s)");
    // Subagent-type-led descriptions read naturally too
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "task", arg: "Explore quiet-status.ts wiring" }],
        elapsedMs: 2_000,
      })
    ).toBe("Exploring quiet-status.ts wiring (2s)");
    // Non-verb-led descriptions keep the Delegating fallback
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "task", arg: "Auth module deep-dive" }],
        elapsedMs: 2_000,
      })
    ).toBe("Delegating Auth module deep-dive (2s)");
  });

  test("ls of the project root names the folder, not the dot (#165)", () => {
    expect(fullQuietArg("ls", { path: "." })).toBe("the project folder");
    expect(
      formatQuietLiveStatus({
        tools: [{ id: "1", name: "ls", arg: "the project folder" }],
        elapsedMs: 1_000,
      })
    ).toBe("Listing the project folder (1s)");
  });

  test("subagent single row: badge + objective | step + tick (#165)", () => {
    const state = {
      codename: "Saratoga",
      objective: "Exploring quiet-status.ts wiring",
      label: "Reading README.md",
      startedAt: 1_000_000,
    };
    expect(stripAnsi(formatQuietSubagentLine(state, 1_012_000, 120))).toBe(
      " Saratoga  Exploring quiet-status.ts wiring | Reading README.md (12s)"
    );
    expect(formatQuietSubagentLine(state, 1_012_000, 120)).toContain(
      "\x1b[1m\x1b[30m\x1b[43m Saratoga \x1b[0m"
    );
    // Width-fitted: the step (right side) truncates, the tick survives
    const fitted = stripAnsi(
      formatQuietSubagentLine(
        { codename: "Saratoga", objective: "Exploring the codebase", label: "x".repeat(120), startedAt: 1_000_000 },
        1_012_000,
        60
      )
    );
    expect(fitted.length).toBeLessThanOrEqual(60);
    expect(fitted.endsWith("(12s)")).toBe(true);
  });

  test("subagent settle row: objective | Worked for, suffix survives narrow widths (#165)", () => {
    const settled = stripAnsi(
      formatQuietSubagentSettle("Saratoga", "Exploring quiet-status.ts wiring", 31_000, 120)
    );
    expect(settled).toBe(" Saratoga  Exploring quiet-status.ts wiring | Worked for 31s");
    const narrow = stripAnsi(
      formatQuietSubagentSettle("Saratoga", "x".repeat(120), 31_000, 40)
    );
    expect(narrow.length).toBeLessThanOrEqual(40);
    expect(narrow.endsWith("Worked for 31s")).toBe(true);
  });

  test("quietToolLabel: bash humanizes, task gerunds stand alone (#165)", () => {
    expect(quietToolLabel("bash", "git log --oneline -5")).toBe("Reviewing recent commits");
    expect(quietToolLabel("task", "Researching github.com/morluto/rea")).toBe(
      "Researching github.com/morluto/rea"
    );
    expect(quietToolLabel("task", "Map the dependency graph")).toBe("Mapping the dependency graph");
    expect(quietToolLabel("file_read", "AGENTS.md")).toBe("Reading AGENTS.md");
    // grep tool alternation patterns extract the topic instead of raw pipes
    expect(quietToolLabel("grep", "subagent-progress-labels|updateToolArg|subagentBadge")).toBe(
      "Searching the code for 'subagent-progress-labels' and 2 more terms"
    );
    expect(quietToolLabel("grep", "quiet-status")).toBe("Searching quiet-status");
  });

  test("tracker: subagents get their own lines; group line hides when solo (#165)", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 1_000_000;
    t.addSubagent("b", "Saratoga", "Researching github.com/morluto/rea", t0);
    // Group line has nothing to narrate while only subagents run
    expect(t.liveStatus(t0 + 5_000)).toBeNull();
    // Objective is static; the live step starts as a generic placeholder
    expect(t.getSubagent("b")?.objective).toBe("Researching github.com/morluto/rea");
    expect(t.getSubagent("b")?.label).toBe("Working…");
    // Progress feed swaps the subagent's label to its current sub-step
    t.updateSubagentLabel("b", "Reading README.md");
    expect(t.getSubagent("b")?.label).toBe("Reading README.md");
    // A main-agent tool joins WHILE the subagent runs → impulse badge (#165)
    t.addTool({ id: "a", name: "file_read", arg: "AGENTS.md" }, t0 + 10_000);
    const concurrent = t.liveStatus(t0 + 13_000);
    expect(concurrent).toContain("\x1b[1m\x1b[30m\x1b[43m impulse \x1b[0m");
    expect(stripAnsi(concurrent!)).toBe(" impulse  Reading AGENTS.md (13s)");
    // Subagent settles with its own wall-clock → badge drops with it
    expect(t.settleSubagent("b", t0 + 31_000)).toBe(31_000);
    expect(t.getSubagent("b")).toBeUndefined();
    expect(t.liveStatus(t0 + 32_000)).toBe("Reading AGENTS.md (32s)");
    // Group settle still credits the subagent; task call counted as a tool
    const settled = t.settle(t0 + 70_000);
    expect(settled!.workedForLine).toBe("Worked for 1 min 10s using 2 tools (1 subagent)");
  });

  test("subagent-only group settle skips 'using N tools' (#165)", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 1_000_000;
    t.addSubagent("b", "Saratoga", "Exploring quiet-status.ts wiring", t0);
    t.settleSubagent("b", t0 + 31_000);
    expect(t.settle(t0 + 38_000)!.workedForLine).toBe("Worked for 38s (1 subagent)");
  });

  test("settle omits helper credit when no subagents ran", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 1_000_000;
    t.addTool({ id: "a", name: "file_read", arg: "AGENTS.md" }, t0);
    expect(t.settle(t0 + 3_000)!.workedForLine).toBe("Worked for 3s using 1 tool");
  });

  test("Recap names the helper when the codename rides metadata (#165)", () => {
    expect(
      buildQuietRecapFact("task", "Researching github.com/morluto/rea", {
        success: true,
        output: "done",
        metadata: { type: "task", codename: "Saratoga" },
      })
    ).toBe("subagent Saratoga: researching github.com/morluto/rea");
    // Legacy/unnamed fallback unchanged
    expect(
      buildQuietRecapFact("task", "review the parser", {
        success: true,
        output: "done",
      })
    ).toBe("delegated review the parser");
  });

  test("intent derives from the reasoning stream; <intent> marker wins", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 1_000_000;
    t.setThinking("assessing", t0);
    t.noteThinkingText("I need to review");
    expect(t.thinkingIntent).toBeNull(); // not enough words yet
    t.noteThinkingText(" the codebase and README before touching the renderer.");
    expect(t.thinkingIntent).toBe("review the codebase and README before touching the");
    t.setThinkingIntent("check the quiet narration path");
    expect(t.thinkingIntent).toBe("check the quiet narration path");
  });

  test("live narration lingers on the last activity while idle", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 2_000_000;
    t.addTool({ id: "1", name: "web_fetch", arg: "https://example.com" }, t0);
    expect(t.liveStatus(t0 + 300)).toBe("Fetching https://example.com (300ms)");
    // Tool finished, nothing running: the label lingers instead of blanking
    // to a generic phrase the composer beacon already shows.
    t.removeTool("1");
    expect(t.liveStatus(t0 + 5_000)).toBe("Fetching https://example.com (5s)");
  });

  test("deriveIntentFromThinking strips filler and caps words", () => {
    expect(deriveIntentFromThinking("Let me look at the auth module tests first.")).toBe(
      "look at the auth module tests first"
    );
    expect(deriveIntentFromThinking("short")).toBeNull();
    expect(deriveIntentFromThinking("one two three")).toBeNull();
  });

  test("parallel tools coalesce with (+N)", () => {
    expect(
      formatQuietLiveStatus({
        tools: [
          { id: "1", name: "file_read", arg: "AGENTS.md" },
          { id: "2", name: "grep", arg: "foo" },
          { id: "3", name: "ls", arg: "src" },
        ],
      })
    ).toBe("Reading AGENTS.md (+2 parallel)");
  });

  test("thinking phrases are fixed set", () => {
    expect(quietThinkingPhrase("assessing")).toBe("Thinking");
    expect(quietThinkingPhrase("planning")).toBe("Thinking");
    expect(
      formatQuietLiveStatus({ thinking: "assessing", tools: [] })
    ).toBe("Thinking");
  });

  test("Worked for uses ms under 1s and whole seconds at/above 1s", () => {
    expect(formatWorkedFor(0)).toBe("Worked for 0ms");
    expect(formatWorkedFor(340)).toBe("Worked for 340ms");
    expect(formatWorkedFor(999)).toBe("Worked for 999ms");
    expect(formatWorkedFor(1000)).toBe("Worked for 1s");
    expect(formatWorkedFor(1500)).toBe("Worked for 2s");
    expect(formatWorkedFor(10400)).toBe("Worked for 10s");
  });

  test("durations roll into minutes past 60s (never a bare second count)", () => {
    expect(formatWorkedFor(65_000)).toBe("Worked for 1 min 5s");
    expect(formatWorkedFor(72_000)).toBe("Worked for 1 min 12s");
    expect(formatWorkedFor(120_000)).toBe("Worked for 2 min");
    expect(formatDuration(61_000)).toBe("1 min 1s");
  });

  test("shortQuietArg uses basename for paths", () => {
    expect(shortQuietArg("file_read", { path: "src/cli/renderer.ts" })).toBe(
      "renderer.ts"
    );
    expect(shortQuietArg("bash", { command: "ls -la" })).toBe("ls -la");
  });

  test("failed/blocked outcomes break Quiet", () => {
    expect(
      isQuietBreakOutcome(
        classifyQuietOutcome({ success: false, output: "permission denied" })
      )
    ).toBe(true);
    expect(
      isQuietBreakOutcome(
        classifyQuietOutcome({ success: false, output: "ENOENT" })
      )
    ).toBe(true);
    expect(
      isQuietBreakOutcome(
        classifyQuietOutcome({ success: true, output: "ok" })
      )
    ).toBe(false);
  });

  test("buildQuietRecapFact: plain-language outcomes (no tool-call echo)", () => {
    // Root / cwd basename → "the project folder" (never folder-name mush)
    expect(
      buildQuietRecapFact("ls", ".", {
        success: true,
        output: "ok",
        metadata: { type: "ls", totalEntries: 27, entryCount: 27, truncated: false },
      })
    ).toBe("looked through the project folder (27 items)");
    expect(
      buildQuietRecapFact("ls", path.basename(process.cwd()), {
        success: true,
        output: "ok",
        metadata: {
          type: "ls",
          path: process.cwd(),
          totalEntries: 27,
          entryCount: 27,
          truncated: false,
        },
      })
    ).toBe("looked through the project folder (27 items)");
    expect(
      buildQuietRecapFact("ls", "src", {
        success: true,
        output: "ok",
        metadata: {
          type: "ls",
          path: "src",
          totalEntries: 10,
          entryCount: 10,
          truncated: false,
        },
      })
    ).toBe("looked through src (10 items)");
    expect(
      buildQuietRecapFact("file_read", "AGENTS.md", {
        success: true,
        output: "ok",
        metadata: { type: "file_read", linesRead: 120 },
      })
    ).toBe("reviewed AGENTS.md");
    expect(
      buildQuietRecapFact("grep", "Recap", {
        success: true,
        output: "ok",
        metadata: { type: "grep", pattern: "Recap", matchCount: 5 },
      })
    ).toBe("found 5 matches for Recap");
    // Common shell commands map to plain intent, not raw command echo
    expect(
      buildQuietRecapFact("bash", "bun test", {
        success: true,
        output: "ok",
        metadata: { type: "bash", command: "bun test" },
      })
    ).toBe("ran the tests");
    // Web facts: protocol stripped, path visible (#173)
    expect(
      buildQuietRecapFact("web_fetch", "https://github.com/spenceriam/jelico", {
        success: true,
        output: "ok",
      })
    ).toBe("viewed spenceriam/jelico on GitHub");
    expect(
      buildQuietRecapFact("bash", "git log", {
        success: true,
        output: "ok",
        metadata: { type: "bash", command: "git log --oneline -20" },
      })
    ).toBe("reviewed recent changes");
    // Unknown command keeps the concrete command
    expect(
      buildQuietRecapFact("bash", "wibblesort --mode 7", {
        success: true,
        output: "ok",
        metadata: { type: "bash", command: "wibblesort --mode 7" },
      })
    ).toBe("ran wibblesort");
    // Vague / no-metadata → null (skip mush)
    expect(
      buildQuietRecapFact("ls", "impulse-pr154", { success: true, output: "ok" })
    ).toBeNull();
    expect(isVagueRecapNoun("looking at files")).toBe(true);
    expect(isVagueRecapNoun("AGENTS.md")).toBe(false);
  });

  test("Recap facts are specific + semicolon-joined, no trailing symbols", () => {
    const line = formatQuietRecap([
      {
        name: "file_read",
        arg: "AGENTS.md",
        outcome: "success",
        fact: "read AGENTS.md (120 lines)",
      },
      {
        name: "ls",
        arg: ".",
        outcome: "success",
        fact: "listed 27 top-level entries",
      },
      {
        name: "bash",
        arg: "bun test",
        outcome: "success",
        fact: "ran bun test",
      },
    ]);
    expect(line).toBe(
      "Recap: read AGENTS.md (120 lines); listed 27 top-level entries; ran bun test"
    );
    expect(line).not.toMatch(/looking at|working on|listing things/i);
  });

  test("Recap done→next: Next only when open work (pending todo)", () => {
    const line = formatQuietRecap(
      [
        {
          name: "file_edit",
          arg: "auth.ts",
          outcome: "success",
          fact: "edited auth.ts",
        },
        {
          name: "bash",
          arg: "bun test",
          outcome: "success",
          fact: "ran bun test",
        },
      ],
      { pendingTodo: "token-refresh test" }
    );
    expect(line).toBe(
      "Recap: edited auth.ts; ran bun test · Next: token-refresh test"
    );
  });

  test("Recap omits Next when turn complete (no open work)", () => {
    const line = formatQuietRecap(
      [
        {
          name: "file_read",
          arg: "AGENTS.md",
          outcome: "success",
          fact: "read AGENTS.md",
        },
      ],
      {
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: null,
        openPlanItem: null,
      }
    );
    expect(line).toBe("Recap: read AGENTS.md");
    expect(line).not.toContain("Next:");
  });

  test("Recap skips vague facts; coalesces multiple file reads", () => {
    const line = formatQuietRecap([
      { name: "file_read", arg: "AGENTS.md", outcome: "success" },
      { name: "file_read", arg: "quiet-status.ts", outcome: "success" },
      { name: "todo_write", arg: "", outcome: "success" }, // skipped
      {
        name: "ls",
        arg: "impulse-pr154",
        outcome: "success",
        // no fact + vague path alone would be mush — with fact it's concrete
        fact: "looked through the project folder (27 items)",
      },
    ]);
    expect(line).toBe(
      "Recap: reviewed AGENTS.md, quiet-status.ts; looked through the project folder (27 items)"
    );
  });

  test("Recap Next prefers todo over failure over unanswered ask over plan", () => {
    expect(
      pickQuietRecapNext({
        pendingTodo: "fix CI",
        lastFailure: "retry bun test",
        unansweredAsk: "answer Platform",
        openPlanItem: "ship Quiet",
      })
    ).toBe("fix CI");
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: "retry bun test",
        unansweredAsk: "answer Platform",
        openPlanItem: "ship Quiet",
      })
    ).toBe("retry bun test");
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: "answer Platform",
        openPlanItem: "ship Quiet",
      })
    ).toBe("answer Platform");
    expect(
      pickQuietRecapNext({
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: null,
        openPlanItem: "ship Quiet",
      })
    ).toBe("ship Quiet");
    expect(pickQuietRecapNext({})).toBeNull();
    expect(
      pickQuietRecapNext({
        pendingTodo: "looking at files",
        lastFailure: null,
        openPlanItem: null,
      })
    ).toBeNull();
  });

  test("lastFailure / unansweredAsk / plan extractors are event-sourced", () => {
    expect(
      lastFailureNextLabel([
        { name: "file_edit", arg: "a.ts", outcome: "success" },
        { name: "bash", arg: "bun test", outcome: "failed" },
      ])
    ).toBe("retry running the tests");
    expect(
      unansweredAskNextLabel([
        { name: "question", arg: "Platform", outcome: "failed" },
      ])
    ).toBe("answer Platform");
    expect(extractOpenPlanItem("- [x] done\n- [ ] token-refresh test\n")).toBe(
      "token-refresh test"
    );
    expect(extractOpenPlanItem("- [x] all done\n")).toBeNull();
  });

  test("Recap includes blocked tools without inventing Next", () => {
    const line = formatQuietRecap(
      [
        {
          name: "bash",
          arg: "rm -rf /",
          outcome: "blocked",
          fact: "ran rm -rf / blocked",
        },
      ],
      {
        lastFailure: null,
        pendingTodo: null,
        unansweredAsk: null,
        openPlanItem: null,
      }
    );
    expect(line).toBe("Recap: ran rm -rf / blocked");
    expect(line).not.toContain("Next:");
  });

  test("Recap auto-Next from failure when open work remains", () => {
    const line = formatQuietRecap([
      {
        name: "bash",
        arg: "bun test",
        outcome: "failed",
        fact: "ran bun test failed",
      },
    ]);
    expect(line).toBe("Recap: ran bun test failed · Next: retry running the tests");
  });

  test("Recap Next absent when hints explicitly cleared (turn complete)", () => {
    const line = formatQuietRecap(
      [
        {
          name: "bash",
          arg: "bun test",
          outcome: "failed",
          fact: "ran bun test failed",
        },
      ],
      {
        pendingTodo: null,
        lastFailure: null,
        unansweredAsk: null,
        openPlanItem: null,
      }
    );
    expect(line).toBe("Recap: ran bun test failed");
    expect(line).not.toContain("Next:");
  });

  test("Recap null when no events or only mush", () => {
    expect(formatQuietRecap([])).toBeNull();
    expect(
      formatQuietRecap([
        { name: "todo_write", arg: "", outcome: "success" },
        { name: "ls", arg: ".", outcome: "success" }, // no fact, vague
      ])
    ).toBeNull();
  });

  test("Recap wrap is at most 3 lines with ellipsis", () => {
    const long = formatQuietRecap([
      {
        name: "file_read",
        arg: "a-very-long-filename-aaaaaaaa.md",
        outcome: "success",
        fact: "read a-very-long-filename-aaaaaaaa.md (80 lines)",
      },
      {
        name: "file_edit",
        arg: "b-very-long-filename-bbbbbbbb.ts",
        outcome: "success",
        fact: "edited b-very-long-filename-bbbbbbbb.ts",
      },
      {
        name: "grep",
        arg: "c-very-long-pattern-cccccccccc",
        outcome: "success",
        fact: "searched c-very-long-pattern-cccccccccc (12 matches)",
      },
      {
        name: "bash",
        arg: "d-very-long-command-dddddddddd",
        outcome: "success",
        fact: "ran d-very-long-command-dddddddddd",
      },
    ]);
    expect(long).not.toBeNull();
    // #168: full wrap, never ellipsize — no 3-line hard cap, no mid-word cut
    const rows = wrapQuietRecapLines(long!, 24);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.join(" ").endsWith("…")).toBe(false);
    expect(rows.join("")).toContain("d-very-long-command-dddddddddd");
  });

  test("Recap wrap under max lines stays untruncated", () => {
    const rows = wrapQuietRecapLines("Recap: read AGENTS.md", 80);
    expect(rows).toEqual(["Recap: read AGENTS.md"]);
  });

  test("web fetch variants dedupe to one Recap fact (#173)", () => {
    // Renderer shape: events carry facts built by buildQuietRecapFact
    const mk = (url: string): QuietRecapEvent => ({
      name: "web_fetch",
      arg: url,
      outcome: "success",
      fact: buildQuietRecapFact("web_fetch", url, { success: true, output: "ok" })!,
    });
    const line = formatQuietRecap([
      mk("https://github.com/spenceriam/jelico"),
      mk("https://github.com/spenceriam/jelico/"),
      mk("http://github.com/spenceriam/jelico"),
    ]);
    expect(line).toBe("Recap: viewed spenceriam/jelico on GitHub");
  });

  test("web fetch facts read as meaning, not URLs (#173)", () => {
    expect(humanizeWebFetchTarget("https://github.com/spenceriam/impulse/issues/173")).toBe(
      "read issue #173 on GitHub"
    );
    expect(humanizeWebFetchTarget("https://github.com/spenceriam/impulse/pull/171")).toBe(
      "read PR #171 on GitHub"
    );
    expect(humanizeWebFetchTarget("https://github.com/spenceriam/impulse/README.md")).toBe(
      "read the README on GitHub"
    );
    expect(humanizeWebFetchTarget("https://github.com/spenceriam/impulse/releases")).toBe(
      "checked releases on GitHub"
    );
    expect(humanizeWebFetchTarget("https://example.com/docs/guide.html")).toBe(
      "read a page from example.com"
    );
    expect(humanizeWebFetchTarget("not a url")).toBeNull();
  });

  test("Recap hard newlines collapse instead of stranding fragments", () => {
    const rows = wrapQuietRecapLines(
      "Recap: mapped revival paths ranked by cost, honest limits, and the\ncurrent legal position.",
      120
    );
    expect(rows).toEqual([
      "Recap: mapped revival paths ranked by cost, honest limits, and the current legal position.",
    ]);
  });

  test("shortQuietArg ls root stays '.' (not cwd basename mush)", () => {
    expect(shortQuietArg("ls", {})).toBe(".");
    expect(shortQuietArg("ls", { path: "." })).toBe(".");
    expect(shortQuietArg("ls", { path: "src/cli" })).toBe("cli");
  });
});

describe("QuietWorkGroupTracker settle-once", () => {
  test("settle emits one Worked for; second settle is null", () => {
    const t = new QuietWorkGroupTracker();
    const t0 = 1_000_000;
    t.addTool({ id: "1", name: "file_read", arg: "AGENTS.md" }, t0);
    t.removeTool("1");
    // Post-tool thinking stays in same group (no settle on tools-done).
    t.setThinking("planning", t0 + 100);

    const first = t.settle(t0 + 340);
    expect(first).not.toBeNull();
    expect(first!.workedForLine).toBe("Worked for 340ms using 1 tool");
    expect(first!.toolCount).toBe(1);
    expect(t.settledCount).toBe(1);

    const second = t.settle(t0 + 500);
    expect(second).toBeNull();
    expect(t.settledCount).toBe(1);
  });

  test("tools then thinking then settle is still one Worked for", () => {
    const t = new QuietWorkGroupTracker();
    t.addTool({ id: "a", name: "file_read", arg: "AGENTS.md" });
    t.addTool({ id: "b", name: "ls", arg: "." });
    t.removeTool("a");
    t.removeTool("b");
    t.setThinking("planning");
    t.setThinking("planning");

    expect(t.settle(Date.now() + 50)).not.toBeNull();
    expect(t.settle()).toBeNull();
    expect(t.settledCount).toBe(1);
  });

  test("new group after settle can emit another Worked for", () => {
    const t = new QuietWorkGroupTracker();
    t.addTool({ id: "1", name: "file_read", arg: "a" });
    expect(t.settle()).not.toBeNull();

    t.markGapBeforeNextWorkedFor();
    t.addTool({ id: "2", name: "ls", arg: "." });
    expect(t.needsGapBeforeWorkedFor).toBe(true);
    expect(t.settle()).not.toBeNull();
    expect(t.settledCount).toBe(2);
    expect(t.consumeGapBeforeWorkedFor()).toBe(true);
    expect(t.consumeGapBeforeWorkedFor()).toBe(false);
  });

  test("idle ensure without activity does not settle", () => {
    const t = new QuietWorkGroupTracker();
    t.ensure();
    expect(t.settle()).toBeNull();
    expect(t.settledCount).toBe(0);
  });
});
