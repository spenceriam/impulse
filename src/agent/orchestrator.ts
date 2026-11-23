/**
 * Orchestrator presets (#221): a planner model decides what to do and an
 * executor model does it, mirroring Google Antigravity's Orchestrator.
 *
 * This module is pure policy: which role runs, when control returns to the
 * planner, and how a preset is labelled. The agent loop wires it up.
 */

export type OrchestratorRole = "planner" | "executor";

export interface OrchestratorRoleConfig {
  /** Full provider-qualified model id, e.g. "kilo/anthropic/claude-opus-5.5". */
  model: string;
  reasoning: string;
}

export interface OrchestratorPreset {
  name: string;
  planner: OrchestratorRoleConfig;
  executor: OrchestratorRoleConfig;
}

export interface OrchestratorConfig {
  enabled: boolean;
  activePreset: string;
  presets: Record<string, OrchestratorPreset>;
}

/** Longest model label shown inside the picker row before truncation. */
export const ORCHESTRATOR_LABEL_MAX = 20;

/**
 * The picker row label: `Orchestrator (<main model>)`, truncated to
 * ORCHESTRATOR_LABEL_MAX characters plus an ellipsis.
 */
export function orchestratorLabel(mainModel: string): string {
  const short = mainModel.split("/").pop() ?? mainModel;
  const clipped =
    short.length > ORCHESTRATOR_LABEL_MAX
      ? `${short.slice(0, ORCHESTRATOR_LABEL_MAX)}…`
      : short;
  return `Orchestrator (${clipped})`;
}

/**
 * Why control should return from the executor to the planner.
 * Mirrors Antigravity's documented triggers.
 */
export type ReplanTrigger =
  | "verification-failed-twice"
  | "unexpected-interface"
  | "unsettled-design"
  | "user-message";

export interface ExecutorProgress {
  /** Consecutive failures of the same verification step. */
  verificationFailures: number;
  /** A tool behaved differently than the plan expected. */
  interfaceUnexpected?: boolean;
  /** The plan did not settle a design choice the work ran into. */
  designUnsettled?: boolean;
  /** The user sent a message while the executor was working. */
  userMessaged?: boolean;
}

/**
 * Decide whether the executor hands control back. The first matching trigger
 * wins; the order follows Antigravity's description (friction first, then the
 * user).
 */
export function shouldReplan(progress: ExecutorProgress): ReplanTrigger | null {
  if (progress.verificationFailures >= 2) return "verification-failed-twice";
  if (progress.interfaceUnexpected) return "unexpected-interface";
  if (progress.designUnsettled) return "unsettled-design";
  if (progress.userMessaged) return "user-message";
  return null;
}

/** Tools the planner may use: read-only, so it plans instead of doing. */
export const PLANNER_ALLOWED_TOOLS = new Set([
  "file_read",
  "glob",
  "grep",
  "ls",
  "web_search",
  "web_fetch",
  "todo_read",
  "todo_write",
  "plan_revision",
  "question",
]);

export function isPlannerTool(name: string): boolean {
  return PLANNER_ALLOWED_TOOLS.has(name);
}

/** Preset for a name, or the active one, or undefined. */
export function resolvePreset(
  config: OrchestratorConfig | undefined,
  name?: string
): OrchestratorPreset | undefined {
  if (!config) return undefined;
  const key = name ?? config.activePreset;
  return config.presets[key];
}

/**
 * Roles of a preset that cannot run because their provider has no key.
 * The caller alerts the user and offers to edit the main model (#221).
 */
export function missingProviderRoles(
  preset: OrchestratorPreset,
  hasProvider: (providerKey: string) => boolean
): OrchestratorRole[] {
  const missing: OrchestratorRole[] = [];
  const providerOf = (model: string) => model.split("/")[0] ?? "";
  if (!hasProvider(providerOf(preset.planner.model))) missing.push("planner");
  if (!hasProvider(providerOf(preset.executor.model))) missing.push("executor");
  return missing;
}
