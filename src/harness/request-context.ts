/**
 * Per-turn request context for harness telemetry (canonical model id).
 */

let currentCanonicalModelId = "unknown";

export function setCurrentCanonicalModelId(modelId: string): void {
  currentCanonicalModelId = modelId.trim() || "unknown";
}

export function getCurrentCanonicalModelId(): string {
  return currentCanonicalModelId;
}
