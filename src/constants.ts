export const MODES = [
  "AGENT",
  "EXPLORE",
  "PLAN",
  "DEBUG",
] as const;

export type Mode = typeof MODES[number];

const LEGACY_MODE_MAP: Record<string, Mode> = {
  AUTO: "AGENT",
  AGENT: "AGENT",
  PLANNER: "PLAN",
  "PLAN-PRD": "PLAN",
  WORK: "AGENT",
  EXPLORE: "EXPLORE",
  PLAN: "PLAN",
  DEBUG: "DEBUG",
};

export function normalizeMode(mode?: string): Mode {
  if (!mode) return "AGENT";
  return LEGACY_MODE_MAP[mode.toUpperCase()] ?? "AGENT";
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
