/**
 * Runtime vision capability probing.
 *
 * Instead of guessing vision support from model names, we send a tiny image
 * through the provider and check whether the model actually responds to it.
 * Results are cached in model-capabilities.json (7-day TTL) via
 * src/api/capabilities.ts so we only probe once per model.
 *
 * Design constraints:
 * - One-shot: send 1 tiny image + 1 specific question, non-streaming.
 * - Minimal cost: ~50-100 tokens total.
 * - Fast timeout: 8s so a slow provider doesn't block the user.
 * - Conservative: if the probe is ambiguous (model ignores the image),
 *   we fall back to name-pattern heuristic rather than falsely claiming vision.
 */

import type { ChatMessage, ChatCompletionResponse } from "./types";

/** A 1x1 transparent PNG, base64-encoded. ~70 bytes raw, ~100 bytes as data URI. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`;

/** Prompt designed to elicit an image-aware response from vision models
 *  while being harmless for text-only models that ignore the image. */
const PROBE_USER_CONTENT: ChatMessage["content"] = [
  { type: "text", text: "Describe this image in exactly one word." },
  { type: "image_url", image_url: { url: TINY_PNG_DATA_URI } },
];

const PROBE_MESSAGES: ChatMessage[] = [
  { role: "user", content: PROBE_USER_CONTENT },
];

/** Tokens that strongly indicate the model "saw" the image. */
const VISION_POSITIVE_KEYWORDS = [
  "pixel", "transparent", "white", "blank", "square", "image", "picture",
  "photo", "visual", "color", "colour", "see", "tiny", "small", "minimal",
];

/** Tokens that indicate the model explicitly rejected or ignored the image. */
const VISION_NEGATIVE_KEYWORDS = [
  "cannot see", "can't see", "do not see", "don't see", "no image",
  "not able to see", "unable to see", "no visual", "text-only", "text only",
  "only text", "not support", "doesn't support", "do not support images",
];

/**
 * Send a vision probe via the given completion function.
 *
 * @param complete  A function that sends a chat completion (non-streaming).
 *                  Usually `provider.complete.bind(provider)` or a wrapper.
 * @param model     The model ID to probe.
 * @param timeoutMs Abort timeout in milliseconds (default 8000).
 * @returns `true` if the model demonstrated vision awareness,
 *          `false` if it clearly rejected or ignored the image,
 *          `undefined` if the probe failed (network, timeout, ambiguous).
 */
export async function probeVisionCapability(
  complete: (options: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature: number;
    signal?: AbortSignal;
  }) => Promise<ChatCompletionResponse>,
  model: string,
  timeoutMs = 8000
): Promise<boolean | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await complete({
      model,
      messages: PROBE_MESSAGES,
      max_tokens: 20,
      temperature: 0,
      signal: controller.signal,
    });

    const rawContent = response.choices[0]?.message?.content;
    const text =
      typeof rawContent === "string" ? rawContent.trim().toLowerCase() : "";
    if (!text) return undefined;

    // Strong negative signal: model explicitly says it can't see images
    if (VISION_NEGATIVE_KEYWORDS.some((k) => text.includes(k))) {
      return false;
    }

    // Positive signal: model uses vocabulary that only makes sense if it saw the image
    if (VISION_POSITIVE_KEYWORDS.some((k) => text.includes(k))) {
      return true;
    }

    // Ambiguous: model gave a generic response (e.g. "hello" or ignored the image).
    // Return undefined so the caller can fall back to heuristic.
    return undefined;
  } catch (error) {
    // Provider rejected the request — often means the model doesn't accept images.
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes("image") ||
        error.message.toLowerCase().includes("vision") ||
        error.message.toLowerCase().includes("multimodal") ||
        error.message.toLowerCase().includes("unsupported") ||
        error.message.toLowerCase().includes("content type"))
    ) {
      return false;
    }
    // Network / timeout / other failure — ambiguous
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
