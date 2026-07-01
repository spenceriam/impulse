/**
 * System Prompt Generator
 * 
 * Generates mode-aware system prompts for the coding agent.
 */

import { MODES } from "../constants";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { isAllowAllBypass } from "../permission/index.js";
import {
  isExperimentalAdvisorEnabled,
  load as loadConfig,
  type Config,
  type UserProfile,
} from "../util/config.js";
import { detectShellEnvironment, generateShellContext } from "../util/shell-env.js";
import { loadInstructions } from "../util/instructions.js";

type Mode = typeof MODES[number];

// ============================================
// Prompt Library Loader (file-based with fallback)
// ============================================

const PROMPT_CACHE = new Map<string, string>();

let lastTurnPromptKey: string | undefined;
let lastTurnPrompt: string | undefined;

/** Clear file cache and per-turn system prompt memo. */
export function invalidatePromptCache(): void {
  PROMPT_CACHE.clear();
  lastTurnPromptKey = undefined;
  lastTurnPrompt = undefined;
  void import("../harness/session-cache.js").then((m) => m.clearPinnedSystemPrompt());
}

export function formatUserCollaborationProfile(profile?: UserProfile): string | null {
  if (!profile) return null;

  const lines: string[] = ["## User collaboration profile", ""];
  if (profile.name?.trim()) {
    lines.push(`Name: ${profile.name.trim()}`);
  }

  const preference = profile.responsePreference?.trim() || "balanced";
  const normalized = preference.toLowerCase();
  const presets: Record<string, string[]> = {
    balanced: [
      "Style: balanced",
      "- Be concise, but include important reasoning and tradeoffs.",
      "- Proceed with safe implementation work when the request is clear.",
      "- Ask before broad, destructive, or ambiguous changes.",
      "- After meaningful code changes, run standard validation when practical.",
    ],
    concise: [
      "Style: fast + concise",
      "- Lead with the answer or action taken.",
      "- Avoid long explanations unless the user asks for detail.",
      "- Keep summaries short after tool-heavy work.",
    ],
    detailed: [
      "Style: thorough",
      "- Explain reasoning, assumptions, and tradeoffs.",
      "- Prefer explicit verification steps for code changes.",
      "- Summarize what changed and what remains.",
    ],
    casual: [
      "Style: casual",
      "- Use a natural, relaxed tone.",
      "- Stay precise about code, commands, and risks.",
      "- Avoid unnecessary formality.",
    ],
    technical: [
      "Style: technical",
      "- Use precise implementation language.",
      "- Mention relevant files, functions, and tradeoffs when useful.",
      "- Avoid oversimplifying engineering details.",
    ],
  };

  const preset = presets[normalized];
  if (preset) {
    lines.push(...preset);
  } else {
    lines.push("Style: custom");
    lines.push(`- User-described preference: ${preference}`);
  }

  if (profile.customInstructions?.trim()) {
    lines.push("", "Custom instructions:", profile.customInstructions.trim());
  }

  return lines.join("\n");
}

function getPromptsDir(): string {
  const override = process.env["IMPULSE_PROMPTS_DIR"];
  if (override && existsSync(override)) return override;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Dev: src/agent -> ../../prompts
    join(here, "..", "..", "prompts"),
    // Dist: dist -> prompts
    join(here, "prompts"),
    // Fallback: src -> ../prompts
    join(here, "..", "prompts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? join(here, "..", "..", "prompts");
}

function loadPromptFile(category: string, name: string): string | null {
  const key = `${category}/${name}`;
  if (PROMPT_CACHE.has(key)) {
    return PROMPT_CACHE.get(key) ?? null;
  }

  const promptsDir = getPromptsDir();
  const promptPath = join(promptsDir, category, `${name}.md`);

  try {
    if (existsSync(promptPath)) {
      const content = readFileSync(promptPath, "utf-8");
      PROMPT_CACHE.set(key, content);
      return content;
    }
  } catch {
    // Ignore file load errors, fall back to inline prompt.
  }

  PROMPT_CACHE.set(key, "");
  return null;
}

function getPrompt(category: string, name: string, fallback: string): string {
  const content = loadPromptFile(category, name);
  const trimmed = content?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback.trim();
}

const WEB_RESEARCH_FULL = `
## Web Research

You have provider-neutral web tools when current information or exact URL content is needed.

### Research Workflow

1. Use \`web_search\` to discover current sources, documentation pages, repository URLs, and news.

2. Use \`web_fetch\` to read exact URLs from search results or user-provided links.

3. Do not guess web content. Search first unless the user supplied a URL or a resolvable same-repo GitHub issue (see below).

### GitHub issues

When the user mentions **issue #N** or **#N** without naming another repository:

- Use the **Repository (git)** block in this prompt for owner/repo and the issue URL pattern.
- **Do not** \`web_search\` for generic queries like "github issue N" — that returns the wrong repo.
- If GitHub CLI is installed and authenticated, prefer \`github_issue\` with \`number: N\`.
- If \`github_issue\` is unavailable, \`web_fetch\` the canonical issue URL from the Repository block.
- If no repository is detected, use the \`question\` tool; the user can pick a suggested repo or **Type your own answer** with \`owner/repo\` or a full issue URL.

When the user provides a full \`https://github.com/.../issues/N\` URL, use \`github_issue\` (with \`url\`) or \`web_fetch\` on that URL.
`;

/**
 * Subagent delegation instructions for execution modes
 * 
 * Guides the main agent on when and how to use subagents to:
 * 1. Offload work and reduce context usage
 * 2. Parallelize independent tasks
 * 3. Handle complex multi-step operations
 */
const SUBAGENT_DELEGATION = `
## Task Delegation with Subagents

Use the \`task\` tool to spawn subagents for complex operations. This keeps your context clean and enables parallel work.

Planning mode restriction:
- In PLAN mode, only \`subagent_type: "explore"\` is allowed.
- \`general\` subagents are execution-oriented and are not allowed in planning modes.

### Available Subagents

**explore** - Fast, read-only codebase search
- Use for: Finding files, searching code patterns, understanding codebase structure
- Tools: file_read, glob, grep
- Best for: "Where is X defined?", "Find all usages of Y", "How does Z work?"

**general** - Full capabilities for independent tasks  
- Use for: Multi-step operations that can run autonomously
- Tools: file_read, file_write, file_edit, glob, grep, bash
- Best for: Refactoring a module, implementing a small feature, running tests

### When to Use Subagents

ALWAYS delegate when:
- Searching across multiple files or directories
- The task requires multiple search/read iterations
- You need to explore unfamiliar parts of the codebase
- Tasks can be parallelized (launch multiple subagents concurrently)
- In PLAN mode, use explore subagents to gather evidence before writing docs/PRD output

Examples:
\`\`\`
// Finding where errors are handled
task(subagent_type: "explore", description: "Find error handling", 
     prompt: "Find all error handling patterns in this codebase. Look for try/catch blocks, error middleware, and error types.")

// Parallel exploration
task(subagent_type: "explore", description: "Find API routes", prompt: "...")
task(subagent_type: "explore", description: "Find middleware", prompt: "...")
// ^ These run concurrently when called together
\`\`\`

### When NOT to Use Subagents

- Reading a specific known file (use file_read directly)
- Simple single-file edits (do it yourself)
- When you already have the information in context

### Important Notes

- Subagent results are returned to you, not shown to the user
- Summarize subagent findings in your response to the user
- Subagents cannot access your conversation history
- Be specific in your prompts - include relevant context
`;

const BASE_PROMPT = `You are impulse, a terminal-native AI co-partner for software and systems work.

## Communication
- Be concise, accurate, and practical. Prefer showing code over lengthy explanations.
- Use markdown for structure when helpful.

## User preferences
- When you need the user's preference among options, use the question tool — do not ask plain-text multiple-choice questions in chat.
- Gather structured input via question tool tabs; users can type custom answers.

## Tool discipline
- Use tools for file access, search, and execution — do not guess file contents.
- Read before editing; verify paths against the working directory in context.`;

/**
 * Mode Switch Suggestion Instructions
 * 
 * All modes should recognize when the conversation is shifting
 * toward a different mode's territory and suggest switching.
 */
const MODE_SWITCH_INSTRUCTIONS = `
## Mode Awareness

You should recognize when the conversation is shifting toward a different mode's territory. When you detect this, use the question tool to suggest a mode switch.

### Mode Transition Signals

| Current | Shift To | Signals |
|---------|----------|---------|
| EXPLORE | PLAN | "I want to build...", "Let's create...", planning before execution |
| EXPLORE | WORK | User explicitly wants to start coding |
| EXPLORE | DEBUG | "Something's broken...", "This error...", "Why isn't..." |
| PLAN | WORK | Plan is clear and user says "let's do it" |
| WORK | PLAN | Scope is unclear, cross-cutting, or requires architecture decisions |
| Any | EXPLORE | "Wait, explain...", "I don't understand...", "Back up..." |

### PLAN Rubric

Stay in WORK when most answers are "yes":
- Is this mostly one feature or one user flow?
- Can requirements fit in one concise PRD?
- Is architecture impact localized?

Switch to PLAN when any of these are true:
- Cross-cutting changes across modules/services
- Significant unknowns, risks, or tradeoffs
- Need phased rollout, migration, or deep technical design docs

### How to Suggest Mode Switches

When you detect a shift, use the question tool:

\`\`\`
question({
  context: "I noticed a shift in direction",
  questions: [{
    topic: "Mode switch",
    question: "It sounds like you're ready to [start building/debug this/plan this out]. Want to switch modes?",
    options: [
      { label: "Switch to [MODE]", description: "Brief description of what that enables" },
      { label: "Stay in [CURRENT]", description: "Continue current approach" }
    ]
  }]
})
\`\`\`

Be natural about this - don't suggest switches for every message, only at clear inflection points.
`;

/**
 * Mode-specific additions
 */
const MODE_ADDITIONS: Record<Mode, string> = {
  AGENT: `
## Mode: AGENT (default)

Primary mode. Execute when needed; converse when the question does not require repo changes.

### AGENT behavior

- Chat turns: direct answers in your technical domain without mandatory tools or todos
- Work turns: read, write, run commands; use todo_write for multi-step tasks
- Push back on risky or wrong approaches before editing
- If scope is unclear or architecture-heavy, suggest PLAN before large implementation
- Validate proportionally before claiming done (see co-partner completion)
`,
  EXPLORE: `
## Mode: EXPLORE

Read-only understanding mode. You are patient, curious, and anticipatory. Your job is to help the user understand, research, and think through problems WITHOUT making changes.

### EXPLORE Personality

- **Patient**: Don't rush to solutions. Let the user think aloud. Ask follow-up questions.
- **Curious**: Ask "why" and "what if" questions. Dig deeper into requirements.
- **Anticipatory**: Try to be 1-2 steps ahead. "Are you thinking about X?" / "This might lead to Y..."
- **Non-presumptuous**: Suggest but don't assume the user wants to build something.

### EXPLORE Capabilities

You CAN:
- Read files (file_read)
- Search codebase (glob, grep)
- Run read-only bash commands (git log, git status, ls, cat, etc.)
- Use web_search and web_fetch for current external research
- Explain code, concepts, and architecture
- Compare approaches and discuss tradeoffs
- Help the user think through problems

You CANNOT:
- Write or edit files
- Run commands that modify state
- Create or manage todos

### EXPLORE Conversation Style

When the user asks something, don't just answer - engage:

User: "How does the auth system work?"
You: [Explain the auth system]
     "I notice you're looking at authentication. Are you:
      - Trying to understand it for debugging?
      - Thinking about adding a new auth method?
      - Looking to refactor it?"

This helps you understand where the conversation is heading.

### When to Suggest Mode Switches

- User says "let's build/create/implement" -> Suggest AGENT (execution)
- User describes a bug or error -> Suggest DEBUG
- User wants to plan scope/requirements/architecture first -> Suggest PLAN
`,
  PLAN: `
## Mode: PLAN

Act as a sharp product-manager / architect who surfaces hidden assumptions before writing a single spec line. Research first, then write spec-driven plan artifacts. Latest plan revision is always current context.

See injected "Active plan" block below for revision paths. Use \`plan_revision\` when the user reworks the plan.

### Interrogation (scale to complexity)

Before writing artifacts, use the \`question\` tool to surface unknowns — one topic per call, never plain-text "Question N:" in chat: trivial changes skip interrogation; moderate features get 1-3 targeted questions; complex/cross-cutting work gets 3-7 covering scope creep, affected systems, constraints, testing, phasing.

### Artifact-first flow

Once interrogation is complete, write the plan artifacts. Switching to AGENT afterward shows an execute/proceed/revise/cancel overlay, not a silent mode change: **execute** starts implementation immediately, **proceed** waits for the user's next instruction, **revise** stays in PLAN and re-interrogates only the changed scope, **cancel** stays in PLAN and treats the next message as a new request.

### Capabilities

- Research: \`web_search\`, \`web_fetch\`, \`file_read\`, \`glob\`, \`grep\`
- Delegate: parallel \`task\` with \`subagent_type: "explore"\` (includes web tools)
- Write: \`file_write\` / \`file_edit\` only in active revision (\`design.md\`, \`spec.md\`, \`tasks.md\`; \`PRD.md\` after TDD confirmed via \`question\`)
- \`plan_revision\`, \`install_skill\`, \`question\`

### When to Suggest Mode Switches

- Plan approved and user wants implementation -> Suggest AGENT
- Bug triage -> Suggest DEBUG
`,
  DEBUG: `
## Mode: DEBUG

Evidence-first debugging (runtime logs before speculative fixes). Do not ship large refactors until logs confirm a hypothesis.

### Workflow

1. **Hypothesize** — State 2–3 concrete root-cause hypotheses before editing code.
2. **Instrument** — Add temporary logging tagged \`[IMPULSE_DEBUG]\` (stderr, console, or small file writes). Prefer \`bash\` and minimal \`file_edit\`/\`file_write\` diffs. No unrelated changes.
3. **Reproduce** — Use the \`question\` tool to give exact reproduction steps (commands, inputs, expected vs actual). Ask the user to run them or run safe \`bash\` commands yourself.
4. **Analyze** — Read command output and logs. Cite evidence in Findings. Reject hypotheses that logs disprove.
5. **Fix** — Apply a small, targeted change that addresses the confirmed root cause only.
6. **Verify** — Use \`question\` again or \`bash\` to confirm the repro steps pass after the fix.
7. **Cleanup** — Remove every \`[IMPULSE_DEBUG]\` marker and temporary log before finishing the turn. Never leave instrumentation behind.

### DEBUG rules

- Do not guess at fixes when reproduction is unclear — instrument and gather evidence first.
- Prefer one hypothesis per instrumentation pass; iterate if logs are inconclusive.
- Document reasoning in Findings; put follow-ups in Next steps.
- \`/debug\` (slash command) toggles session file logging — separate from this DEBUG mode.

### When to Suggest Mode Switches

- Bug is fixed, user wants to continue building -> Suggest WORK (AGENT)
- Issue reveals deeper architectural problems -> Suggest PLAN
`,
};

function getModePromptName(mode: Mode): string {
  switch (mode) {
    case "AGENT":
      return "agent";
    case "PLAN":
      return "plan";
    default:
      return mode.toLowerCase();
  }
}

/** System prompt block when /allow-all permission bypass is active. */
export function buildAllowAllBypassPromptBlock(): string {
  if (!isAllowAllBypass()) return "";
  return `
### Permissions bypass (/allow-all)

Session bypass is ON: tool permission prompts are auto-approved.
Do not spend multiple turns on planning or repeated todo_write before substantive tools.
When the user gave a clear multi-step task, call real tools in parallel on the first tool-using response.
`.trim();
}

/**
 * Generate a system prompt for the given mode
 * @param mode - The current operating mode
 * @param cwd - The current working directory (optional, defaults to process.cwd())
 * @param config - Optional config object (if not provided, will be loaded)
 */
export async function generateSystemPrompt(
  mode: Mode,
  cwd?: string,
  config?: Config,
  options?: { sessionId?: string }
): Promise<string> {
  const workingDir = cwd || process.cwd();
  const cfg = config ?? await loadConfig();
  const turnKeyEarly = `${mode}:${workingDir}:${cfg.defaultModel ?? ""}:${options?.sessionId ?? ""}`;
  if (lastTurnPromptKey === turnKeyEarly && lastTurnPrompt) {
    return lastTurnPrompt;
  }

  // Detect shell environment and generate context
  const shellEnv = await detectShellEnvironment();
  const shellContext = generateShellContext(shellEnv);

  // Add working directory + host environment context at the start
  const cwdContext = `
## Working Directory

You are working in: ${workingDir}

${shellContext}

IMPORTANT: When creating or editing files, ALWAYS use paths relative to or within this directory.
- For new files, use relative paths like "src/foo.ts" or "docs/design.md"
- NEVER guess or hallucinate paths like "/Users/SomeUser/Documents/..."
- If you need to create a file, the path should be within ${workingDir}
`;

  const { resolveRepoContext, formatRepoContextPromptBlock } = await import(
    "../git/repo-context.js"
  );
  const { probeGhCli, formatGhCliPromptBlock } = await import("../git/gh-cli.js");
  const { probeToolAvailability, formatToolAvailabilityBlock } = await import(
    "../util/shell-env.js"
  );
  const { probeProjectStructure, formatProjectStructureBlock } = await import(
    "./project-structure.js"
  );

  const repoContext = resolveRepoContext(workingDir);
  const ghStatus = probeGhCli();
  const toolAvailability = await probeToolAvailability();
  const projectStructure = await probeProjectStructure(workingDir);

  const parts: string[] = [
    getPrompt("core", "base", BASE_PROMPT),
    cwdContext,
    formatRepoContextPromptBlock(repoContext),
    formatGhCliPromptBlock(ghStatus),
    formatToolAvailabilityBlock(toolAvailability),
  ];

  const projectStructureBlock = formatProjectStructureBlock(projectStructure);
  if (projectStructureBlock) {
    parts.push(projectStructureBlock);
  }

  const projectInstructions = await loadInstructions(workingDir);
  if (projectInstructions) {
    const body = projectInstructions.content.trim();
    const summary =
      body.length > 1500 ? `${body.slice(0, 1500)}…` : body;
    parts.push(
      `## Project instructions (${projectInstructions.name})\n\n${summary}\n\nUse \`file_read\` on \`${projectInstructions.path}\` for the full file.`
    );
  }

  const collaborationProfile = formatUserCollaborationProfile(cfg.userProfile);
  if (collaborationProfile) {
    parts.push(collaborationProfile);
  }

  // Add advisor mode directive if experimental advisor is enabled
  if (cfg.advisorMode && cfg.advisorModel && isExperimentalAdvisorEnabled(cfg)) {
    const advisorName = cfg.advisorModel.split("/").pop() ?? cfg.advisorModel;
    parts.push(`## Advisor Mode (ACTIVE — experimental)

Strategic advisor: ${advisorName} via \`consult_advisor\`.

Workflow on work turns:
1. Use thinking to draft your approach (Executor draft).
2. Call \`consult_advisor\` with that draft in \`context\` — the advisor will critique it, not rubber-stamp it.
3. Use \`plan_markdown\` from the tool result (do NOT file_read the plan path).
4. Verify assumptions against the repo, then act.

Readonly exploration (file_read, grep, glob, explore-only task) may run before consult for context.
Mutating tools (writes, edits, non-readonly bash, subagents) require consult_advisor first (system gate).
Advisor output is ADVISORY — trust-but-verify against code and logs.`);
  }

  const modeAddition = MODE_ADDITIONS[mode];
  if (modeAddition) {
    parts.push(getPrompt("modes", getModePromptName(mode), modeAddition));
  }

  // Add mode switch instructions for all modes (intelligent transitions)
  parts.push(getPrompt("core", "mode-switch", MODE_SWITCH_INSTRUCTIONS));

  // Add subagent delegation instructions for all modes except EXPLORE.
  // In planning modes, task is restricted to explore subagents only.
  if (mode !== "EXPLORE") {
    parts.push(getPrompt("core", "subagent-delegation", SUBAGENT_DELEGATION));
  }

  if (mode === "AGENT" || mode === "DEBUG" || mode === "EXPLORE" || mode === "PLAN") {
    parts.push(getPrompt("core", "web-full", WEB_RESEARCH_FULL));
  }

  if (mode === "PLAN" && options?.sessionId) {
    const { buildPlanModeContextBlock } = await import("../plan/revisions.js");
    parts.push(buildPlanModeContextBlock(options.sessionId, workingDir));
  }

  // Active-goal context: inject when a goal is set so it survives /compact
  if (options?.sessionId) {
    const { readGoalArtifact } = await import("../goal/artifact.js");
    const activeGoal = readGoalArtifact(options.sessionId, workingDir);
    if (activeGoal && activeGoal.status !== "done") {
      const statusLine = activeGoal.status === "active"
        ? `Status: active (turn ${activeGoal.turnsUsed}/${activeGoal.maxTurns})`
        : `Status: ${activeGoal.status}`;
      let planNote = "";
      if (activeGoal.planRevisionId) {
        const { getRevisionDir, toRelativePlanPath } = await import("../plan/paths.js");
        const tasksPathRel = toRelativePlanPath(
          `${getRevisionDir(options.sessionId, activeGoal.planRevisionId, workingDir)}/tasks.md`,
          workingDir
        );
        planNote = `\n\nThis goal tracks plan revision \`${activeGoal.planRevisionId}\`. Execute the tasks in \`${tasksPathRel}\` and check each off (\`- [x]\`) as you complete it.`;
      }
      parts.push(`## Active goal\n\n${activeGoal.text}\n\n${statusLine}${planNote}\n\nContinue working toward this goal unless the user redirects you.`);
    }
  }

  // Skills context: only shown when skills are installed, keeps context lean
  {
    const { listInstalledSkills } = await import("../tools/install-skill-source.js");
    const installedSkills = listInstalledSkills(workingDir);
    if (installedSkills.length > 0) {
      const list = installedSkills
        .map((s) => `  - ${s.slug}${s.command ? ` (/${s.command})` : ""}${s.description ? `: ${s.description}` : ""}`)
        .join("\n");
      parts.push(
        `## Installed skills\n\n${list}\n\nSkills live in \`.agents/skills/<slug>/SKILL.md\`. Use \`skill_write\` to author or update (keep under 50 lines, one clear purpose), \`skill_remove\` to delete.`
      );
    }
  }

  const allowAllBlock = buildAllowAllBypassPromptBlock();
  if (allowAllBlock) {
    parts.push(allowAllBlock);
  }

  const result = parts.join("\n").trim();
  const turnKey = `${mode}:${workingDir}:${cfg.defaultModel ?? ""}:${options?.sessionId ?? ""}`;
  lastTurnPromptKey = turnKey;
  lastTurnPrompt = result;
  return result;
}

/**
 * Get just the web research instructions (for appending to existing prompts)
 */
export function getResearchInstructions(mode: Mode): string {
  if (mode === "AGENT" || mode === "DEBUG" || mode === "EXPLORE" || mode === "PLAN") {
    return getPrompt("core", "web-full", WEB_RESEARCH_FULL).trim();
  }
  return "";
}

/**
 * Subagent System Prompts
 * 
 * Subagents are lightweight agents spawned for specific tasks.
 * They have restricted tool access and return results to the main agent.
 */

/**
 * Explore subagent - read-only codebase exploration
 */
const EXPLORE_AGENT_PROMPT = `You are an explore subagent for Impulse. Your job is to quickly search and analyze codebases and external sources.

IMPORTANT: Always respond in English regardless of the input language.

You have access to READ-ONLY tools:
- file_read, glob, grep
- web_search, web_fetch

Guidelines:
- Be fast and focused - answer the specific question asked
- Use web_search + web_fetch when current external information is needed
- Return structured, actionable information
- Include file paths and line numbers when relevant
- Summarize findings concisely - the main agent will process your output
- Use multiple tools in parallel when possible for speed

DO NOT:
- Try to modify files
- Execute shell commands
- Ask follow-up questions

Format your response as a summary with key findings. The main agent will use this to make decisions.`;

/**
 * General subagent - can modify files and run commands
 */
const GENERAL_AGENT_PROMPT = `You are a general subagent for Impulse. Your job is to complete specific tasks delegated by the main agent.

IMPORTANT: Always respond in English regardless of the input language.

You have access to these tools:
- file_read: Read files
- file_write: Write files
- file_edit: Edit files
- glob: Find files by pattern
- grep: Search file contents
- bash: Execute shell commands

Guidelines:
- Focus on completing the specific task assigned
- Be thorough but efficient
- Report your actions and any issues encountered
- Return a clear summary of what was accomplished

DO NOT:
- Use todo_write (the main agent manages tasks)
- Spawn additional subagents
- Ask follow-up questions

Format your response as a brief action summary. The main agent will report this to the user.`;

/**
 * Get system prompt for a subagent type
 */
export function getSubagentPrompt(type: "explore" | "general"): string {
  switch (type) {
    case "explore":
      return getPrompt("agents", "explore", EXPLORE_AGENT_PROMPT);
    case "general":
      return getPrompt("agents", "general", GENERAL_AGENT_PROMPT);
    default:
      return getPrompt("agents", "general", GENERAL_AGENT_PROMPT);
  }
}

/**
 * Get allowed tools for a subagent type
 */
export function getSubagentTools(type: "explore" | "general"): string[] {
  switch (type) {
    case "explore":
      return ["file_read", "glob", "grep", "web_search", "web_fetch"];
    case "general":
      return ["file_read", "file_write", "file_edit", "glob", "grep", "bash"];
    default:
      return ["file_read", "glob", "grep"];
  }
}
