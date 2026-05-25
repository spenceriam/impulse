import type { Component } from "@mariozechner/pi-tui";
import {
  MODEL_PROVIDERS,
  discoverModels,
  getCachedModelInfos,
  providerConfig,
  type ModelProviderOption,
} from "../model-setup.js";
import { load as loadConfig, type Config } from "../../util/config.js";
import type { ModelInfo } from "../model-catalog.js";
import {
  SelectableListOverlay,
  type SelectableListRow,
} from "./selectable-list-overlay.js";

export interface ModelPickerState {
  overlay: SelectableListOverlay;
  configuredProviderCount: number;
  /** Refresh overlay rows after discovery */
  onRowsUpdated?: () => void;
  discover: () => Promise<void>;
}

function flatRows(
  entries: Array<{ providerKey: string; label: string; infos: ModelInfo[] }>
): SelectableListRow[] {
  const rows: SelectableListRow[] = [];
  const multi = entries.filter((e) => e.infos.length > 0).length > 1;

  for (const entry of entries) {
    if (entry.infos.length === 0) continue;
    if (multi) {
      rows.push({
        id: `__header__${entry.providerKey}`,
        label: `── ${entry.label} ──`,
      });
    }
    for (const info of entry.infos) {
      rows.push({
        id: `${entry.providerKey}\0${info.id}`,
        label: info.pickerLine,
      });
    }
  }
  return rows;
}

/**
 * Build model picker overlay state from config.
 */
export async function buildModelPickerState(
  config: Config,
  opts?: { maxHeight?: number }
): Promise<ModelPickerState> {
  const providers =
    (config.providers as Record<
      string,
      { apiKey?: string; baseUrl?: string; type?: string }
    >) ?? {};

  const entries: Array<{
    provider: ModelProviderOption;
    providerKey: string;
    label: string;
    infos: ModelInfo[];
    loading: boolean;
    error?: string;
  }> = [];

  for (const mp of MODEL_PROVIDERS) {
    if (mp.isCustom) {
      const customKeys = Object.keys(providers).filter(
        (k) => !MODEL_PROVIDERS.some((p) => !p.isCustom && p.key === k)
      );
      for (const key of customKeys) {
        const stored = providerConfig(config, key);
        if (!stored.apiKey) continue;
        const cached = getCachedModelInfos(key);
        entries.push({
          provider: { ...mp, key, label: key },
          providerKey: key,
          label: key,
          infos: cached ?? [],
          loading: !cached,
        });
      }
      continue;
    }

    const stored = providerConfig(config, mp.key);
    if (!stored.apiKey) continue;
    const cached = getCachedModelInfos(mp.key);
    entries.push({
      provider: mp,
      providerKey: mp.key,
      label: mp.label,
      infos: cached ?? [],
      loading: !cached,
    });
  }

  const overlay = new SelectableListOverlay({
    title: "Switch model",
    rows: flatRows(entries),
    loading: entries.some((e) => e.loading),
    loadingMessage: "  Discovering models…",
    emptyMessage: "  No models available",
    maxHeight: opts?.maxHeight ?? 18,
  });

  const state: ModelPickerState = {
    overlay,
    configuredProviderCount: entries.length,
    async discover() {
      for (const entry of entries) {
        if (!entry.loading) continue;
        const stored = providerConfig(config, entry.providerKey);
        try {
          const result = await discoverModels(
            entry.provider,
            stored.apiKey!,
            stored.baseUrl
          );
          entry.infos = result.success
            ? (getCachedModelInfos(entry.providerKey) ?? [])
            : [];
          entry.loading = false;
          if (!result.success) entry.error = result.message;
        } catch (err) {
          entry.loading = false;
          entry.error = (err as Error).message;
        }
      }
      const rows = flatRows(entries);
      const stillLoading = entries.some((e) => e.loading);
      const anyModels = rows.some((r) => !r.id.startsWith("__header__"));
      overlay.setRows(rows);
      if (!anyModels && !stillLoading) {
        overlay.setLoading(false);
      }
      state.onRowsUpdated?.();
    },
  };

  return state;
}

/** @deprecated Use buildModelPickerState */
export class ModelPickerOverlay implements Component {
  private inner: SelectableListOverlay;

  onSelect?: (providerKey: string, modelName: string) => void;
  onCancel?: () => void;

  constructor(_providers: unknown[], config: Config) {
    this.inner = new SelectableListOverlay({
      title: "Switch model",
      rows: [],
      loading: true,
    });
    void buildModelPickerState(config).then((s) => {
      this.inner = s.overlay;
      this.inner.onSelect = (compound) => {
        const [pk, ...rest] = compound.split("\0");
        const model = rest.join("\0");
        if (pk && model && !compound.startsWith("__header__")) {
          this.onSelect?.(pk, model);
        }
      };
      this.inner.onCancel = () => this.onCancel?.();
      void s.discover().then(() => s.onRowsUpdated?.());
    });
  }

  invalidate(): void {
    this.inner.invalidate();
  }

  handleInput(data: string): void {
    this.inner.handleInput(data);
  }

  render(width: number): string[] {
    return this.inner.render(width);
  }
}

export function parseModelPickerSelection(
  compoundId: string
): { providerKey: string; modelId: string } | null {
  if (compoundId.startsWith("__header__")) return null;
  const idx = compoundId.indexOf("\0");
  if (idx < 0) return null;
  return {
    providerKey: compoundId.slice(0, idx),
    modelId: compoundId.slice(idx + 1),
  };
}
