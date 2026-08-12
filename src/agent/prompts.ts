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
  isExperimentalGoalEnabled,
  load as loadConfig,
  type Config,
  type UserProfile,
} from "../util/config.js";
import { detectShellEnvironment, generateShellContext } from "../util/shell-env.js";
import { loadInstructions, clearInstructionCache } from "../util/instructions.js";
import {
  loadEffectiveUserInstructions,
  type EffectiveUserInstructions,
} from "../util/user-instructions.js";

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
  clearInstructionCache();
  void import("../harness/session-cache.js").then((m) => m.clearPinnedSystemPrompt());
}

export function formatUserCollaborationProfile(
  profile?: UserProfile,
  effectiveInstructions?: EffectiveUserInstructions,
  options?: { instructionToolAvailable?: boolean }
): string | null {
  if (!profile && !effectiveInstructions?.content) return null;

  const lines: string[] = [
    "## User collaboration profile",
    "",
    "Profile settings source: ~/.impulse/config.json",
  ];
  if (profile?.name?.trim()) {
    lines.push(`Name: ${profile.name.trim()}`);
  }

  const preference = profile?.responsePreference?.trim() || "balanced";
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

  const instructions = effectiveInstructions?.content ?? profile?.customInstructions ?? "";
  if (instructions.trim()) {
    const source = effectiveInstructions?.sourceLabel ?? "~/.impulse/config.json";
    const instructionLines = [
      "",
      `Persistent instructions source: ${source}`,
      "The Impulse host already loaded these instructions. Do not search the workspace to verify their source.",
      "",
      "Custom instructions:",
      instructions,
    ];
    if (options?.instructionToolAvailable !== false) {
      instructionLines.splice(
        3,
        0,
        "Use user_instructions only when the user explicitly asks to persist a replacement, append, import, or clear operation."
      );
    }
    lines.push(...instructionLines);
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

ASK authority restriction:
- In ASK, only \`subagent_type: "explore"\` is allowed. For general/writing delegation, use \`execution_handoff\` for direct user authority.
- \`general\` subagents require AGENT execution authority.

### Available Subagents

**explore** - Fast, read-only codebase search
- Use for: Finding files, searching code patterns, understanding codebase structure
- Tools: file_read, glob, grep, ls
- Best for: "Where is X defined?", "Find all usages of Y", "How does Z work?"

**general** - Full capabilities for independent tasks
- Use for: Multi-step operations that can run autonomously
- Tools: file_read, file_write, file_edit, glob, grep, ls, bash
- Best for: Refactoring a module, implementing a small feature, running tests

### When to Use Subagents

ALWAYS delegate when:
- Searching across multiple files or directories
- The task requires multiple search/read iterations
- You need to explore unfamiliar parts of the codebase
- Tasks can be parallelized (launch multiple subagents concurrently)
- In ASK, use explore subagents to gather evidence for explanation, planning, and diagnosis

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
 * Both modes recognize when the conversation shifts across the authority boundary.
 */
const MODE_SWITCH_INSTRUCTIONS = `
## Mode transitions

ASK is the default read-only authority. AGENT is explicit execution authority.

- ASK -> AGENT: never call set_mode to elevate. For consequential work, call \`execution_handoff\`; only its direct-user choice or an explicit /mode AGENT/Tab transition grants authority.
- AGENT -> ASK: use set_mode when the work returns to explanation, research, planning, or read-only diagnosis.
- Never silently elevate authority or suggest a transition when the current mode already fits.
`;

/**
 * Mode-specific additions
 */
const MODE_ADDITIONS: Record<Mode, string> = {
  ASK: `
## Mode: ASK

ASK is the visible default for read-only understanding. Use it for explanation, codebase and web research, planning, architecture discussion, and evidence-first diagnosis without changing the project.

### ASK authority

- You may read and search the project, research external sources, ask questions, update session-only todos/header state, and launch explore subagents.
- You cannot write or edit project files, execute bash commands, stop background jobs, install/write/remove skills, persist user instructions, or launch general subagents.
- Planning in ASK produces advice in the conversation; it does not create or mutate project plan artifacts.
- Diagnosis in ASK starts with read-only evidence and explore subagents. If a reproduction, test run, instrumentation, or fix is needed, use \`execution_handoff\` rather than inventing a privileged debug mode.
- When the most useful next evidence must come from the user's environment, ask them for one minimal command or test and have them paste the result; do not imply that Allow-All is debugging authority or a sandbox.
- When consequential execution is needed, call \`execution_handoff\`. Its UI lets the user directly choose Preview safely (recommended), Switch to AGENT, or Stay in ASK. Never synthesize, infer, or replay that choice, and never silently elevate authority.
`,
  AGENT: `
## Mode: AGENT

AGENT has explicit execution authority. You may read, write, and run commands to complete the user's authorized task end-to-end.

### AGENT behavior

- Chat turns: direct answers in your technical domain without mandatory tools or todos
- Work turns: read, write, and run commands; use todo_write for multi-step tasks
- Push back on risky or wrong approaches before editing
- If the user wants to return to read-only explanation, planning, or diagnosis, de-escalate to ASK
- Validate proportionally before claiming done (see co-partner completion)
`,
};

function getModePromptName(mode: Mode): string {
  return mode.toLowerCase();
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
  options?: { sessionId?: string; userInstructionsPath?: string }
): Promise<string> {
  const workingDir = cwd || process.cwd();
  const cfg = config ?? await loadConfig();
  const effectiveUserInstructions = await loadEffectiveUserInstructions(
    cfg.userProfile?.customInstructions,
    options?.userInstructionsPath
  );
  const experimentalGoal = isExperimentalGoalEnabled(cfg);
  let goalCacheKey = "off";
  if (options?.sessionId && experimentalGoal) {
    const { readGoalArtifact } = await import("../goal/artifact.js");
    const goal = readGoalArtifact(options.sessionId, workingDir);
    if (goal && goal.status !== "done") {
      goalCacheKey = JSON.stringify({
        text: goal.text,
        status: goal.status,
        turnsUsed: goal.turnsUsed,
        planRevisionId: goal.planRevisionId ?? "",
      });
    }
  }
  const profileCacheKey = JSON.stringify({
    name: cfg.userProfile?.name ?? "",
    responsePreference: cfg.userProfile?.responsePreference ?? "balanced",
    instructions: effectiveUserInstructions.fingerprint,
  });
  const turnKey = `${mode}:${workingDir}:${cfg.defaultModel ?? ""}:${options?.sessionId ?? ""}:goal=${goalCacheKey}:profile=${profileCacheKey}`;
  const turnKeyEarly = turnKey;
  if (lastTurnPromptKey === turnKeyEarly && lastTurnPrompt) {
    return lastTurnPrompt;
  }

  // Detect shell environment and generate context
  const shellEnv = await detectShellEnvironment();
  const shellContext = generateShellContext(shellEnv);

  // Add working directory + host environment context at the start
  const authorityPathGuidance = mode === "AGENT"
    ? `IMPORTANT: When creating or editing files, ALWAYS use paths relative to or within this directory.
- For new files, use relative paths like "src/foo.ts" or "docs/design.md"
- NEVER guess or hallucinate paths like "/Users/SomeUser/Documents/..."
- If you need to create a file, the path should be within ${workingDir}`
    : "ASK is project-read-only. Use this directory only for reading and searching; do not create or edit files.";
  const cwdContext = `
## Working Directory

You are working in: ${workingDir}

${shellContext}

${authorityPathGuidance}
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

  const collaborationProfile = formatUserCollaborationProfile(
    cfg.userProfile,
    effectiveUserInstructions,
    { instructionToolAvailable: mode === "AGENT" }
  );
  if (collaborationProfile) {
    parts.push(collaborationProfile);
  }

  // Add advisor workflow directive if experimental advisor is enabled
  if (mode === "AGENT" && cfg.advisorMode && cfg.advisorModel && isExperimentalAdvisorEnabled(cfg)) {
    const advisorName = cfg.advisorModel.split("/").pop() ?? cfg.advisorModel;
    parts.push(`## Advisor workflow (ACTIVE — experimental)

Strategic advisor: ${advisorName} via \`consult_advisor\`.

Workflow on work turns:
1. Use thinking to draft your approach (Executor draft).
2. Call \`consult_advisor\` with that draft in \`context\` — the advisor will critique it, not rubber-stamp it.
3. Use \`plan_markdown\` from the tool result (do NOT file_read the plan path).
4. Verify assumptions against the repo, then act.

Readonly exploration (file_read, grep, glob, ls, explore-only task) may run before consult for context.
Mutating tools (writes, edits, non-readonly bash, subagents) require consult_advisor first (system gate).
Advisor output is ADVISORY — trust-but-verify against code and logs.`);
  }

  const modeAddition = MODE_ADDITIONS[mode];
  if (modeAddition) {
    parts.push(getPrompt("modes", getModePromptName(mode), modeAddition));
  }

  // Add mode switch instructions for all modes (intelligent transitions)
  parts.push(getPrompt("core", "mode-switch", MODE_SWITCH_INSTRUCTIONS));

  parts.push(getPrompt("core", "subagent-delegation", SUBAGENT_DELEGATION));

  parts.push(getPrompt("core", "web-full", WEB_RESEARCH_FULL));

  // Active-goal context: inject when a goal is set so it survives /compact
  if (options?.sessionId && experimentalGoal) {
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
      const continuationNote = activeGoal.status === "active"
        ? "Continue working toward this goal unless the user redirects you."
        : "The goal loop is paused — do not auto-continue toward this goal until the user resumes it with /goal resume.";
      parts.push(`## Active goal\n\n${activeGoal.text}\n\n${statusLine}${planNote}\n\n${continuationNote}`);
    }
  }

  // Skills context: only shown when skills are installed, keeps context lean
  {
    const { listInstalledSkills } = await import("../tools/install-skill-source.js");
    const installedSkills = listInstalledSkills(workingDir);
    if (installedSkills.length > 0) {
      const list = installedSkills
        .map((s) => `  - ${s.slug}${s.description ? `: ${s.description}` : ""}`)
        .join("\n");
      const skillAuthority = mode === "AGENT"
        ? "Use `skill_write` to author or update and `skill_remove` to delete, only when the user asks."
        : "In ASK, apply read-only guidance from skills. If a skill needs project mutation, use the execution handoff; installing, writing, or removing skills requires AGENT.";
      parts.push(`## Installed skills\n\n${list}\n\nCompare each user request to the installed skill names and descriptions. When a skill is relevant, read its SKILL.md completely before acting and follow it. Do not wait for the user to name a skill. Skills live in \`.agents/skills/<slug>/SKILL.md\`. ${skillAuthority}`);
    } else {
      parts.push(mode === "AGENT"
        ? "## Skills\n\nNone installed. Only install or create one when the user explicitly asks."
        : "## Skills\n\nNone installed. Installing or creating skills requires the user to switch to AGENT.");
    }
  }

  if (mode === "AGENT") {
    parts.push(`## Background jobs

Use \`bash(background: true)\` for dev servers, watchers, or long-running processes that should not block the conversation.
- Returns immediately with a job ID (e.g. \`bg-1\`).
- Use \`bg_output(id)\` to read buffered output.
- Use \`bg_kill(id)\` to stop a job.
- For commands that finish in <30s, prefer normal blocking \`bash\`.`);
  }

  const allowAllBlock = buildAllowAllBypassPromptBlock();
  if (allowAllBlock) {
    parts.push(allowAllBlock);
  }

  const result = parts.join("\n").trim();
  lastTurnPromptKey = turnKey;
  lastTurnPrompt = result;
  return result;
}

/**
 * Get just the web research instructions (for appending to existing prompts)
 */
export function getResearchInstructions(mode: Mode): string {
  if (mode === "AGENT" || mode === "ASK") {
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
- file_read, glob, grep, ls
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
- ls: List directory contents
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
      return ["file_read", "glob", "grep", "ls", "web_search", "web_fetch"];
    case "general":
      return ["file_read", "file_write", "file_edit", "glob", "grep", "ls", "bash"];
    default:
      return ["file_read", "glob", "grep", "ls"];
  }
}
