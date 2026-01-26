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

export const MODES = [
  "AUTO",
  "EXPLORE",
  "AGENT",
  "PLANNER",
  "PLAN-PRD",
  "DEBUG",
] as const;
