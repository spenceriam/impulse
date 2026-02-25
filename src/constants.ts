export const GLM_MODELS = [
  "glm-4.7",
  "glm-4.7-flash",
  "glm-4.6",
  "glm-4.6v",
  "glm-4.5",
  "glm-4.5-air",
  "glm-4.5-flash",
  "glm-4.5v",
] as const;

export const MODES = [
  "WORK",
  "EXPLORE",
  "PLAN",
  "DEBUG",
] as const;

export type Mode = typeof MODES[number];

const LEGACY_MODE_MAP: Record<string, Mode> = {
  AUTO: "WORK",
  AGENT: "WORK",
  PLANNER: "PLAN",
  "PLAN-PRD": "PLAN",
  WORK: "WORK",
  EXPLORE: "EXPLORE",
  PLAN: "PLAN",
  DEBUG: "DEBUG",
};

export function normalizeMode(mode?: string): Mode {
  if (!mode) return "WORK";
  return LEGACY_MODE_MAP[mode.toUpperCase()] ?? "WORK";
}

/**
 * Friendly display names for models
 * Maps API model names to user-facing display names
 * Format: "GLM X.Y" for base, "GLM X.Y-Variant" for variants
 */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
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
 * Get friendly display name for a model
 * Falls back to uppercase version of API name if not found
 */
export function getModelDisplayName(model: string): string {
  return MODEL_DISPLAY_NAMES[model.toLowerCase()] || model.toUpperCase();
}
