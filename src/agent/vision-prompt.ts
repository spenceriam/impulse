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
