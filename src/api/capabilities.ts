/**
 * Model capability discovery and caching.
 *
 * Design: each provider optionally implements `discoverModelCapabilities(model)`
 * which probes the provider API (e.g. /v1/models, /api/show) for authoritative
 * capability data.  Results are cached per model ID in `model-capabilities.json`.
 *
 * When discovery is unavailable, a lightweight name-pattern heuristic is used
 * as a last resort (see `modelSupportsVisionFallback`).
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { Global } from "../global.js";

const CACHE_FILE = `${Global.Path.cache}/model-capabilities.json`;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ModelCapabilities {
  vision: boolean;
  reasoning: boolean;
  contextLength?: number;
  maxOutputTokens?: number;
    discoveredAt: number; // timestamp
    source: "provider-api" | "heuristic" | "user-override" | "catalog";
}

let cache: Map<string, ModelCapabilities> | null = null;

function getCachePath(): string {
  return CACHE_FILE;
}

function loadCache(): Map<string, ModelCapabilities> {
  if (cache) return cache;
  cache = new Map();
  try {
    if (existsSync(getCachePath())) {
      const raw = JSON.parse(readFileSync(getCachePath(), "utf-8")) as Record<
        string,
        ModelCapabilities
      >;
      const now = Date.now();
      for (const [k, v] of Object.entries(raw)) {
        if (now - v.discoveredAt < CACHE_TTL_MS) {
          cache.set(k, v);
        }
      }
    }
  } catch {
    // ignore corrupt cache
  }
  return cache;
}

function saveCache(): void {
  if (!cache) return;
  const obj: Record<string, ModelCapabilities> = {};
  for (const [k, v] of cache) obj[k] = v;
  try {
    writeFileSync(getCachePath(), JSON.stringify(obj, null, 2));
  } catch {
    // ignore write errors
  }
}

/** Set capability for a model (used by provider discovery or user override). */
export function setModelCapabilities(
  model: string,
  caps: Omit<ModelCapabilities, "discoveredAt">
): void {
  const c = loadCache();
  c.set(model.toLowerCase(), { ...caps, discoveredAt: Date.now() });
  saveCache();
}

/**
 * Remove a cached capability entry (e.g. stale heuristic results that
 * shadow better data). No-op when the model has no cached entry.
 */
export function clearModelCapabilities(model: string): void {
  const c = loadCache();
  if (c.delete(model.toLowerCase())) saveCache();
}

/** Get cached capability or undefined. */
export function getModelCapabilities(model: string): ModelCapabilities | undefined {
  return loadCache().get(model.toLowerCase());
}

/**
 * Sync vision check for UI paths (model picker, setup wizard, paste guard).
 * The cache stores both bare ("glm-5.3-flash") and prefixed
 * ("ollama/glm-5.3-flash") ids depending on which layer warmed it, so the
 * lookup normalizes: try the given key, then its bare form, then its
 * provider-prefixed form. Falls back to name-pattern heuristic only.
 */
export function modelSupportsVisionCached(model: string): boolean {
  const c = loadCache();
  const key = model.toLowerCase();
  const cached =
    c.get(key) ??
    (model.includes("/")
      ? c.get(key.slice(key.indexOf("/") + 1)) ?? c.get(`ollama/${key.slice(key.indexOf("/") + 1)}`)
      : undefined);
  if (cached) return cached.vision;
  return modelSupportsVisionFallback(model);
}

/** Check whether a model supports vision, using cache -> probe -> heuristic. */
export async function modelSupportsVision(
  model: string,
  discover?: () => Promise<ModelCapabilities | undefined>,
  probe?: () => Promise<boolean | undefined>
): Promise<boolean> {
  const cached = getModelCapabilities(model);

  // 1. Try provider API discovery (e.g. /v1/models, /api/show).
  // A cached heuristic guess must not shadow authoritative discovery, so
  // discovery runs even when the cache has an entry.
  if (discover) {
    const found = await discover();
    if (found) {
      setModelCapabilities(model, found);
      return found.vision;
    }
  }

  if (cached) return cached.vision;

    // 2. Runtime probe: send a tiny image and see if the model responds to it
    if (probe) {
      const result = await probe();
      if (result !== undefined) {
        setModelCapabilities(model, {
          vision: result,
          reasoning: false, // probe doesn't discover reasoning
          source: "provider-api",
        });
        return result;
      }
    }

    // 3. Last resort: name-pattern heuristic — computed, never cached.
    // (Caching heuristic guesses is what let wrong results shadow correct
    //  catalog data for the 7-day cache TTL.)
    return modelSupportsVisionFallback(model);
  }

/** Best-effort fallback: well-known naming patterns.
 *  Do NOT treat as authoritative — this is a last resort when the provider API
 *  does not expose capability metadata.
 */
export function modelSupportsVisionFallback(model: string): boolean {
  const lower = model.toLowerCase();
  const visionPatterns = [
    "vision", "vl", "omni", "gpt-4o", "gpt-4-turbo",
    "claude-3", "claude-3.5", "claude-3.7", "claude-4",
    "gemini-2", "gemini-flash", "gemini-pro-vision",
    "llama-3.2-vision", "llava", "pixtral",
    "qwen2-vl", "qwen-vl", "cogvlm", "fuyu",
    "minicpm-v", "internvl", "phi-3-vision",
    "yi-vision", "step-1v", "glm-4v", "glm-4.6v",
    "kimi-k2",
  ];
  return visionPatterns.some((p) => lower.includes(p));
}
