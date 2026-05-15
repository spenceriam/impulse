# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- When requirements are ambiguous, ask clarifying questions rather than implementing based on assumptions — especially for UI/UX and unclear concepts. Confidence: 0.90

# ui-ux
- Use accessible, non-technical language in user-facing UI overlays and prompts — avoid jargon that assumes AI coding tool familiarity. Confidence: 0.80
- When an API call fails, surface the raw API error message (e.g., timeout reason, token limit, auth failure) directly in the UI rather than wrapping it in generic language. Confidence: 0.75
- For image pastes in the prompt input, use user-friendly labels like "[Pasted image #1]" with cumulative numbering across pastes (not resetting per paste), so vision tool blocks can reference specific images. Avoid technical descriptions referencing lines or character counts. Confidence: 0.80

