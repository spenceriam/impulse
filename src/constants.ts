export const MODES = [
  "ASK",
  "AGENT",
] as const;

export type Mode = typeof MODES[number];

/** Canonical runtime authority at process and renderer startup. */
export const DEFAULT_MODE: Mode = "ASK";

const LEGACY_MODE_MAP: Record<string, Mode> = {
  AUTO: "AGENT",
  AGENT: "AGENT",
  WORK: "AGENT",
  ASK: "ASK",
  EXPLORE: "ASK",
  PLAN: "ASK",
  PLANNER: "ASK",
  "PLAN-PRD": "ASK",
  DEBUG: "ASK",
};

export function normalizeMode(mode?: string): Mode {
  if (!mode) return DEFAULT_MODE;
  return LEGACY_MODE_MAP[mode.toUpperCase()] ?? DEFAULT_MODE;
}

/** User-facing canonical mode label. */
export function displayModeLabel(mode: Mode | string): string {
  return normalizeMode(mode);
}

/** Safe default mode for new and unrecognized state. */
export function isDefaultMode(mode: Mode | string): boolean {
  return normalizeMode(mode) === DEFAULT_MODE;
}

/** Modes shown in /mode help and Tab cycling. */
export const MODE_CYCLE: Mode[] = ["ASK", "AGENT"];

export function displayModeOptions(): string {
  return MODE_CYCLE.map(displayModeLabel).join(" | ");
}

/** Friendly display names for known provider models. */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "z.ai/glm-4.7": "Z.ai GLM 4.7",
  "z.ai/glm-4.7-flash": "Z.ai GLM 4.7-Flash",
  "z.ai/glm-4.6": "Z.ai GLM 4.6",
  "z.ai/glm-4.6v": "Z.ai GLM 4.6-Vision",
  "z.ai/glm-4.5": "Z.ai GLM 4.5",
  "z.ai/glm-4.5-air": "Z.ai GLM 4.5-Air",
  "z.ai/glm-4.5-flash": "Z.ai GLM 4.5-Flash",
  "z.ai/glm-4.5v": "Z.ai GLM 4.5-Vision",
  "glm-4.7": "GLM 4.7",
  "glm-4.7-flash": "GLM 4.7-Flash",
  "glm-4.6": "GLM 4.6",
  "glm-4.6v": "GLM 4.6-Vision",
  "glm-4.5": "GLM 4.5",
  "glm-4.5-air": "GLM 4.5-Air",
  "glm-4.5-flash": "GLM 4.5-Flash",
  "glm-4.5v": "GLM 4.5-Vision",
};

/**
 * Get friendly display name for a model.
 * Falls back to the provider-prefixed model string if not known.
 */
export function getModelDisplayName(model: string): string {
  const lower = model.toLowerCase();
  return MODEL_DISPLAY_NAMES[lower] || model;
}
