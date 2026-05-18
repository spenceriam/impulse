# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- When requirements are ambiguous, ask clarifying questions rather than implementing based on assumptions — especially for UI/UX and unclear concepts. Confidence: 0.90
- In public-facing PR descriptions and release notes, avoid including internal operational notes (e.g., tag push status, local state, release trigger instructions) — these undermine confidence and are poor etiquette for public repositories. Confidence: 0.85

# ui-ux
- Use accessible, non-technical language in user-facing UI overlays and prompts — avoid jargon that assumes AI coding tool familiarity. Confidence: 0.80
- When an API call fails, surface the raw API error message (e.g., timeout reason, token limit, auth failure) directly in the UI rather than wrapping it in generic language. Confidence: 0.75
- For image pastes in the prompt input, use user-friendly labels like "[Pasted image #1]" with cumulative numbering across pastes (not resetting per paste), so vision tool blocks can reference specific images. Avoid technical descriptions referencing lines or character counts. Confidence: 0.80
- For the model selector overlay, show models as a flat list grouped by provider when multiple providers are configured, not a purely flat list. Confidence: 0.65
- Keep the main header line static with app identity and version (e.g., "IMPULSE | cli coding agent | v1.0.2"). Session titles belong only in the session picker overlay, not in the main header. Confidence: 0.70
