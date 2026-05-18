import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@mariozechner/pi-tui";
import {
  MODEL_PROVIDERS,
  discoverModels,
  getCachedModels,
  providerConfig,
  type ModelProviderOption,
} from "../model-setup.js";
import { load as loadConfig, type Config } from "../../util/config.js";

const DARK_BG = "\x1b[48;5;233m";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};

const dimText = (s: string) => A.fg(90, s);
const highlight = (s: string) => A.fg(36, s);

function padToWidth(line: string, width: number): string {
  const truncated = truncateToWidth(line, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return `${truncated}${" ".repeat(padding)}`;
}

function bgLine(line: string, width: number): string {
  const padded = padToWidth(line, width).replace(/\x1b\[0m/g, `${A.reset}${DARK_BG}`);
  return `${DARK_BG}${padded}${A.reset}`;
}

interface ProviderEntry {
  provider: ModelProviderOption;
  models: string[];
  loading: boolean;
  error?: string;
}

interface FlatModel {
  providerKey: string;
  model: string;
}

export class ModelPickerOverlay implements Component {
  private providers: ProviderEntry[];
  private allModels: FlatModel[];
  private filtered: FlatModel[];
  private searchQuery = "";
  private selectedIndex = 0;
  private config: Config;

  onSelect?: (providerKey: string, modelName: string) => void;
  onCancel?: () => void;

  constructor(providers: ProviderEntry[], config: Config) {
    this.providers = providers;
    this.config = config;
    this.allModels = this.buildFlatList();
    this.filtered = [...this.allModels];
  }

  private buildFlatList(): FlatModel[] {
    const list: FlatModel[] = [];
    for (const entry of this.providers) {
      for (const model of entry.models) {
        list.push({ providerKey: entry.provider.key, model });
      }
    }
    return list;
  }

  invalidate(): void {}

  private applyFilter(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filtered = [...this.allModels];
    } else {
      this.filtered = this.allModels.filter((m) =>
        m.model.toLowerCase().includes(q)
      );
    }
    if (this.selectedIndex >= this.filtered.length) {
      this.selectedIndex = Math.max(0, this.filtered.length - 1);
    }
  }

  handleInput(data: string): void {
    if (data === "\r") {
      const selected = this.filtered[this.selectedIndex];
      if (selected) {
        this.onSelect?.(selected.providerKey, selected.model);
      }
      return;
    }

    if (data === "\x1b") {
      this.onCancel?.();
      return;
    }

    if (data === "\x1b[A") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }

    if (data === "\x1b[B") {
      this.selectedIndex = Math.min(
        this.filtered.length - 1,
        this.selectedIndex + 1
      );
      return;
    }

    if (data === "\x7f" || data === "\b") {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.applyFilter();
      }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.searchQuery += data;
      this.applyFilter();
    }
  }

  render(width: number): string[] {
    const boxWidth = Math.max(60, Math.min(width - 4, 74));
    const innerWidth = Math.max(20, boxWidth - 4);
    const lines: string[] = [];

    // Current model in header
    const currentModel = this.config.defaultModel ?? "none";
    const shortModel = currentModel.split("/").slice(0, 2).join("/");
    const headerTitle = `Switch model — ${shortModel}`;
    const dashPad = Math.max(0, boxWidth - headerTitle.length - 6);

    // Top border
    lines.push(bgLine(`┌─ ${headerTitle} ${"─".repeat(dashPad)}┐`, boxWidth));
    lines.push(bgLine("│" + " ".repeat(boxWidth - 2) + "│", boxWidth));

    // Search bar
    const searchPlaceholder = this.searchQuery
      ? `Search: ${this.searchQuery}_`
      : "Search: _";
    lines.push(bgLine(`│ ${padToWidth(searchPlaceholder, innerWidth)} │`, boxWidth));
    lines.push(bgLine("│" + " ".repeat(boxWidth - 2) + "│", boxWidth));

    // Model list — flat, grouped by provider if multiple providers have models
    if (this.allModels.length === 0) {
      const loading = this.providers.some((p) => p.loading);
      const msg = loading
        ? dimText("  Discovering models...")
        : dimText("  No models available");
      lines.push(bgLine(`│ ${padToWidth(msg, innerWidth)} │`, boxWidth));
    } else if (this.filtered.length === 0) {
      lines.push(bgLine(`│ ${padToWidth(dimText(`  No models matching "${this.searchQuery}"`), innerWidth)} │`, boxWidth));
    } else {
      const visibleRows = Math.min(this.filtered.length, 12);
      const scrollOffset = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(visibleRows / 2),
          this.filtered.length - visibleRows
        )
      );

      // Multiple providers? Show section headers
      const multiProvider = new Set(this.filtered.map((m) => m.providerKey)).size > 1;
      let lastProvider = "";

      for (let i = scrollOffset; i < scrollOffset + visibleRows && i < this.filtered.length; i++) {
        const entry = this.filtered[i]!;
        const isSelected = i === this.selectedIndex;

        // Section header for provider groups
        if (multiProvider && entry.providerKey !== lastProvider) {
          lastProvider = entry.providerKey;
          const providerLabel = this.providers.find((p) => p.provider.key === entry.providerKey)?.provider.label ?? entry.providerKey;
          lines.push(bgLine(`│ ${padToWidth(dimText(`── ${providerLabel} ──`), innerWidth)} │`, boxWidth));
        }

        const displayName = this.formatModel(entry.model);
        const line = isSelected
          ? `  > ${highlight(displayName)}`
          : `    ${displayName}`;
        lines.push(bgLine(`│ ${padToWidth(line, innerWidth)} │`, boxWidth));
      }
    }

    lines.push(bgLine("│" + " ".repeat(boxWidth - 2) + "│", boxWidth));

    // Help text
    const help = dimText("↑/↓ navigate   Type to filter   Enter select   Esc cancel");
    lines.push(bgLine(`│ ${padToWidth(help, innerWidth)} │`, boxWidth));

    // Bottom border
    lines.push(bgLine(`└${"─".repeat(boxWidth - 2)}┘`, boxWidth));

    return lines;
  }

  private formatModel(full: string): string {
    // Strip common provider prefix if present
    return full.replace(/^(ollama|openrouter|openai|z\.ai|anthropic|groq|gemini|nous)\//, "");
  }
}

/**
 * Build provider entries for the model picker from the current config.
 * Uses cached model lists where available, and triggers discovery
 * where needed (caller should await the promises).
 */
export async function buildProviderEntries(): Promise<{
  entries: ProviderEntry[];
  promises: Promise<void>[];
}> {
  const config = await loadConfig();
  const providers = config.providers as Record<string, { apiKey?: string; baseUrl?: string; type?: string }> | undefined ?? {};
  const entries: ProviderEntry[] = [];
  const promises: Promise<void>[] = [];

  for (const mp of MODEL_PROVIDERS) {
    // Only include custom providers that are actually configured
    if (mp.isCustom) {
      // For custom providers, check if any custom keys are configured
      const customKeys = Object.keys(providers).filter(
        (k) => !MODEL_PROVIDERS.some((p) => !p.isCustom && p.key === k)
      );
      for (const key of customKeys) {
        const stored = providerConfig(config, key);
        if (stored.apiKey) {
          const cached = getCachedModels(key);
          if (cached) {
            entries.push({
              provider: { ...mp, key, label: key },
              models: cached,
              loading: false,
            });
          } else {
            entries.push({
              provider: { ...mp, key, label: key },
              models: [],
              loading: true,
            });
            promises.push(
              (async () => {
                try {
                  const result = await discoverModels(
                    { ...mp, key, label: key },
                    stored.apiKey!,
                    stored.baseUrl
                  );
                  const e = entries.find((x) => x.provider.key === key);
                  if (e) {
                    e.models = result.models;
                    e.loading = false;
                  }
                } catch (err) {
                  const e = entries.find((x) => x.provider.key === key);
                  if (e) {
                    e.error = (err as Error).message;
                    e.loading = false;
                  }
                }
              })()
            );
          }
        }
      }
      continue;
    }

    // Standard provider
    const stored = providerConfig(config, mp.key);
    if (stored.apiKey) {
      const cached = getCachedModels(mp.key);
      if (cached) {
        entries.push({
          provider: mp,
          models: cached,
          loading: false,
        });
      } else {
        entries.push({
          provider: mp,
          models: [],
          loading: true,
        });
        promises.push(
          (async () => {
            try {
              const result = await discoverModels(
                mp,
                stored.apiKey!,
                stored.baseUrl
              );
              const e = entries.find((x) => x.provider.key === mp.key);
              if (e) {
                e.models = result.models;
                e.loading = false;
              }
            } catch (err) {
              const e = entries.find((x) => x.provider.key === mp.key);
              if (e) {
                e.error = (err as Error).message;
                e.loading = false;
              }
            }
          })()
        );
      }
    }
  }

  return { entries, promises };
}
