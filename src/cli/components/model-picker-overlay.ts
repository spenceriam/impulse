import type { Component } from "@mariozechner/pi-tui";
import {
  MODEL_PROVIDERS,
  discoverModels,
  getCachedModelInfos,
  listConfiguredCustomProviderKeys,
  providerConfig,
  resolveCustomProviderOption,
  type ModelProviderOption,
} from "../model-setup.js";
import type { Config } from "../../util/config.js";
import {
  formatContextK,
  formatModelDate,
  type ModelInfo,
} from "../model-catalog.js";
import { modelSupportsVisionCached } from "../../api/capabilities.js";
import {
  SelectableListOverlay,
  type SelectableListRow,
  type SelectableListTableHeaders,
} from "./selectable-list-overlay.js";

export interface ModelPickerState {
  overlay: SelectableListOverlay;
  configuredProviderCount: number;
  /** Refresh overlay rows after discovery */
  onRowsUpdated?: () => void;
  discover: () => Promise<void>;
}

const PROVIDER_SEPARATOR = "--------------------";

export const MODEL_PICKER_TABLE_HEADERS: SelectableListTableHeaders = {
  title: "Model",
  mode: "Ctx",
  model: "",
  updated: "Added",
};

export function modelInfoToTableCells(info: ModelInfo): {
  title: string;
  mode: string;
  model: string;
  updated: string;
} {
  const title = `${info.vendor}/${info.displayName} (${info.id})`;
  const mode =
    info.contextTokens != null ? formatContextK(info.contextTokens) : "—";
  const updated = info.addedAt ? formatModelDate(info.addedAt) : "—";
  return { title, mode, model: "", updated };
}

/** Build grouped rows for model picker (exported for tests). */
export function buildProviderGroupedRows(
  entries: Array<{ providerKey: string; label: string; infos: ModelInfo[] }>
): SelectableListRow[] {
  const rows: SelectableListRow[] = [];
  const withModels = entries.filter((e) => e.infos.length > 0);
  let first = true;

  for (const entry of withModels) {
    if (!first) {
      rows.push({
        id: `__sep__${entry.providerKey}`,
        label: PROVIDER_SEPARATOR,
      });
    }
    first = false;
    rows.push({
      id: `__header__${entry.providerKey}`,
      label: `${entry.label}:`,
    });
    for (const info of entry.infos) {
      const cells = modelInfoToTableCells(info);
      rows.push({
        id: `${entry.providerKey}\0${info.id}`,
        label: info.pickerLine,
        tableCells: cells,
      });
    }
  }
  return rows;
}

function flatRows(
  entries: Array<{ providerKey: string; label: string; infos: ModelInfo[] }>
): SelectableListRow[] {
  return buildProviderGroupedRows(entries);
}

export interface BuildModelPickerOptions {
  maxHeight?: number;
  visionOnly?: boolean;
  title?: string;
  emptyMessage?: string;
  helpLines?: string[];
}

/**
 * Build model picker overlay state from config.
 */
export async function buildModelPickerState(
  config: Config,
  opts?: BuildModelPickerOptions
): Promise<ModelPickerState> {
  const entries: Array<{
    provider: ModelProviderOption;
    providerKey: string;
    label: string;
    infos: ModelInfo[];
    loading: boolean;
    error?: string;
  }> = [];

  for (const key of listConfiguredCustomProviderKeys(config)) {
    const stored = providerConfig(config, key);
    if (!stored.apiKey) continue;
    const cached = getCachedModelInfos(key);
    entries.push({
      provider: resolveCustomProviderOption(key, config),
      providerKey: key,
      label: key,
      infos: cached ?? [],
      loading: !cached,
    });
  }

  for (const mp of MODEL_PROVIDERS) {
    if (mp.isCustom) continue;

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

  const filterVision = (infos: ModelInfo[]) =>
    opts?.visionOnly
      ? infos.filter((i) => modelSupportsVisionCached(i.id))
      : infos;

  const overlay = new SelectableListOverlay({
    title: opts?.title ?? (opts?.visionOnly ? "Switch vision model" : "Switch model"),
    rows: flatRows(
      entries.map((e) => ({
        providerKey: e.providerKey,
        label: e.label,
        infos: filterVision(e.infos),
      }))
    ),
    loading: entries.some((e) => e.loading),
    loadingMessage: "  Discovering models…",
    emptyMessage:
      opts?.emptyMessage ??
      (opts?.visionOnly
        ? "  No vision-capable models for configured providers"
        : "  No models available"),
    maxHeight: opts?.maxHeight ?? 18,
    boxSizing: "responsive",
    layout: "table",
    tableHeaders: MODEL_PICKER_TABLE_HEADERS,
    tableOmitModelColumn: true,
    helpLines: opts?.helpLines ?? [
      "↑/↓ navigate   Type to filter   Enter select   m: Manage providers   Esc cancel",
    ],
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
      const rows = flatRows(
        entries.map((e) => ({
          providerKey: e.providerKey,
          label: e.label,
          infos: filterVision(e.infos),
        }))
      );
      const stillLoading = entries.some((e) => e.loading);
      const anyModels = rows.some(
        (r) => !r.id.startsWith("__header__") && !r.id.startsWith("__sep__")
      );
      overlay.setRows(rows);
      if (!anyModels && !stillLoading) {
        overlay.setLoading(false);
      }
      state.onRowsUpdated?.();
    },
  };

  return state;
}

/** Vision-only model picker. */
export async function buildVisionModelPickerState(
  config: Config,
  opts?: { maxHeight?: number }
): Promise<ModelPickerState> {
  return buildModelPickerState(config, {
    ...opts,
    visionOnly: true,
    title: "Switch vision model",
    emptyMessage: "  No vision-capable models for configured providers",
  });
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
  if (compoundId.startsWith("__header__") || compoundId.startsWith("__sep__")) return null;
  const idx = compoundId.indexOf("\0");
  if (idx < 0) return null;
  return {
    providerKey: compoundId.slice(0, idx),
    modelId: compoundId.slice(idx + 1),
  };
}
