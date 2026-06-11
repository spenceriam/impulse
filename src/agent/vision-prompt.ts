/** Max user request text embedded in the vision translation prompt. */
export const VISION_USER_REQUEST_MAX = 1500;

/**
 * Build the vision-model user prompt for image translation (describe-only bias).
 */
export function buildVisionTranslatePrompt(userRequest: string): string {
  const trimmed = userRequest.trim();
  const quoted =
    trimmed.length > 0
      ? `"${trimmed.slice(0, VISION_USER_REQUEST_MAX).replace(/"/g, "'")}"`
      : "(no text request)";

  return [
    `User request: ${quoted}`,
    "",
    "Describe what is visible in this image (text, UI, layout, errors, code if shown).",
    "Be concise and factual.",
    "Do not suggest next steps, ask what to do, or assume a coding task unless the user explicitly asked for one.",
  ].join("\n");
}

/**
 * Build a runtime self-knowledge statement about vision capabilities.
 * This eliminates the model's uncertainty about whether it can see images.
 */
export function buildVisionSelfKnowledge(config: {
  nativeVision: boolean;
  visionModeEnabled: boolean;
  visionModel?: string | null | undefined;
}): string {
  if (config.nativeVision) {
    return `## Your Vision Configuration

You are a native vision-capable model. When users paste images, you receive them directly as base64 image_url content blocks alongside the text. You can see and analyze the actual image content.`;
  }

  if (config.visionModeEnabled && config.visionModel) {
    return `## Your Vision Configuration

You are a text-only model. Images pasted by the user are sent to a separate vision model (${config.visionModel}) and replaced with text descriptions in your input as "[Pasted image #N]: <description>". You do not receive raw image data.`;
  }

  return `## Your Vision Configuration

You are a text-only model with no vision support. Images pasted by the user are replaced with the literal placeholder "[Pasted image #N]" in your input. You cannot analyze image content.`;
}
