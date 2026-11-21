/**
 * Provider login/logout list (#211).
 *
 * One row per known provider showing whether a key is configured and how many
 * models were last discovered. The model count comes from the discovery cache
 * and is refreshed on a TTL, never on every open (a network call per provider
 * per keystroke would be worse than the stale count).
 */

import type { SelectableListRow } from "./components/selectable-list-overlay.js";
import type { ModelProviderOption } from "./model-setup.js";

export const PROVIDER_LOGIN_ROW_PREFIX = "__provider__";

/** Re-discover a provider's models at most this often. */
export const MODEL_COUNT_TTL_MS = 6 * 60 * 60 * 1000;

export interface ProviderLoginEntry {
  key: string;
  label: string;
  hasKey: boolean;
  /** Cached model count, or null when never discovered. */
  modelCount: number | null;
}

export function providerLoginEntries(
  providers: ModelProviderOption[],
  hasKey: (key: string) => boolean,
  modelCount: (key: string) => number | null
): ProviderLoginEntry[] {
  return providers
    .filter((p) => !p.isCustom)
    .map((p) => ({
      key: p.key,
      label: p.label,
      hasKey: hasKey(p.key),
      modelCount: modelCount(p.key),
    }));
}

export const PROVIDER_LOGIN_TABLE_HEADERS = {
  title: "Provider",
  mode: "Models",
  model: "Key",
  updated: "",
};

export function buildProviderLoginRows(entries: ProviderLoginEntry[]): SelectableListRow[] {
  return entries.map((entry) => ({
    id: `${PROVIDER_LOGIN_ROW_PREFIX}${entry.key}`,
    label: entry.label,
    tableCells: {
      title: entry.label,
      mode: entry.modelCount === null ? "—" : String(entry.modelCount),
      model: entry.hasKey ? "● set" : "○ not set",
      updated: "",
    },
  }));
}

export function parseProviderLoginRow(rowId: string): string | null {
  if (!rowId.startsWith(PROVIDER_LOGIN_ROW_PREFIX)) return null;
  const key = rowId.slice(PROVIDER_LOGIN_ROW_PREFIX.length);
  return key.length > 0 ? key : null;
}

export function isModelCountStale(discoveredAt: number | undefined, now = Date.now()): boolean {
  if (discoveredAt === undefined) return true;
  return now - discoveredAt > MODEL_COUNT_TTL_MS;
}
