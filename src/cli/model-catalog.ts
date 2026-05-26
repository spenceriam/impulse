/**
 * models.dev catalog enrichment for model picker rows.
 */

import fs from "fs/promises";
import path from "path";
import { Global } from "../global.js";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_FILE = path.join(Global.Path.cache, "models-dev.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Impulse provider key → models.dev bucket id */
export const CATALOG_ALIASES: Record<string, string> = {
  ollama: "ollama-cloud",
  openrouter: "openrouter",
  openai: "openai",
  anthropic: "anthropic",
  groq: "groq",
  gemini: "google",
  nous: "nous",
  "z.ai": "zai",
};

const VENDOR_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  "deepseek-thinking": "DeepSeek",
  "deepseek-flash": "DeepSeek",
  glm: "Zhipu",
  kimi: "Moonshot",
  "kimi-thinking": "Moonshot",
  gemma: "Google",
  gemini: "Google",
  "gemini-flash": "Google",
  qwen: "Alibaba",
  minimax: "MiniMax",
  nemotron: "NVIDIA",
  mistral: "Mistral",
  devstral: "Mistral",
  ministral: "Mistral",
  "mistral-large": "Mistral",
  "gpt-oss": "OpenAI",
  cogito: "Deep Cogito",
  rnj: "RNJ",
  anthropic: "Anthropic",
  meta: "Meta",
  "meta-llama": "Meta",
  google: "Google",
  openai: "OpenAI",
  liquid: "Liquid",
  prime: "Prime Intellect",
  "prime-intellect": "Prime Intellect",
};

export interface ModelsDevRecord {
  id?: string;
  name?: string;
  family?: string;
  release_date?: string;
  last_updated?: string;
  knowledge?: string;
  limit?: { context?: number; input?: number; output?: number };
}

export interface ModelInfo {
  id: string;
  vendor: string;
  displayName: string;
  contextTokens?: number;
  addedAt?: Date;
  pickerLine: string;
}

export interface ProviderModelEntry {
  id: string;
  context_length?: number;
  created?: number;
  created_at?: string;
}

type CatalogData = Record<
  string,
  { name?: string; models?: Record<string, ModelsDevRecord> }
>;

let catalogCache: { loadedAt: number; data: CatalogData } | null = null;
let globalIndex: Map<string, { bucket: string; record: ModelsDevRecord }> | null =
  null;

export function formatContextK(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m >= 10 ? `${Math.round(m)}m` : `${m.toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

export function formatModelDate(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${dt.getFullYear()}`;
}

export function vendorLabel(familyOrSegment: string | undefined): string {
  if (!familyOrSegment) return "—";
  const key = familyOrSegment.toLowerCase();
  if (VENDOR_LABELS[key]) return VENDOR_LABELS[key]!;
  for (const [prefix, label] of Object.entries(VENDOR_LABELS)) {
    if (key.startsWith(prefix)) return label;
  }
  return familyOrSegment
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function titleCaseSlug(id: string): string {
  const bare = id.replace(/^[^/]+\//, "").split(":")[0] ?? id;
  return bare.replace(/-/g, " ").replace(/_/g, " ");
}

function isHumanName(name: string, id: string): boolean {
  if (name === id) return false;
  if (name.includes(" ")) return true;
  return !/^[a-z0-9._:-]+$/i.test(name);
}

function normKeys(id: string): string[] {
  const bare = id.replace(/^(ollama|openrouter|openai|anthropic|groq|gemini|nous|z\.ai)\//, "");
  const keys = new Set([bare, id]);
  if (bare.includes(":")) keys.add(bare.split(":")[0]!);
  const segs = bare.split("/");
  if (segs.length > 1) {
    keys.add(segs[segs.length - 1]!);
    keys.add(segs.join("-"));
  }
  return [...keys];
}

function parseAddedAt(record?: ModelsDevRecord, api?: ProviderModelEntry): Date | undefined {
  const raw =
    record?.release_date ??
    record?.last_updated ??
    record?.knowledge ??
    (api?.created ? new Date(api.created * 1000).toISOString() : undefined) ??
    api?.created_at;
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function formatModelPickerLine(info: {
  vendor: string;
  displayName: string;
  id: string;
  contextTokens?: number;
  addedAt?: Date;
}): string {
  const left = `${info.vendor}/${info.displayName} (${info.id})`;
  const ctx =
    info.contextTokens != null ? formatContextK(info.contextTokens) : "—";
  const added = info.addedAt ? formatModelDate(info.addedAt) : "—";
  return `${left} | Ctx: ${ctx} | Added: ${added}`;
}

async function loadCatalogFile(): Promise<CatalogData | null> {
  try {
    const stat = await fs.stat(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      const raw = await fs.readFile(CACHE_FILE, "utf-8");
      return JSON.parse(raw) as CatalogData;
    }
  } catch {
    // fetch fresh
  }
  return null;
}

export async function loadModelsDevCatalog(): Promise<CatalogData> {
  if (catalogCache && Date.now() - catalogCache.loadedAt < CACHE_TTL_MS) {
    return catalogCache.data;
  }

  let data = await loadCatalogFile();
  if (!data) {
    const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
    data = (await res.json()) as CatalogData;
    await fs.mkdir(Global.Path.cache, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(data), "utf-8");
  }

  catalogCache = { loadedAt: Date.now(), data };
  globalIndex = null;
  return data;
}

function buildGlobalIndex(data: CatalogData): Map<string, { bucket: string; record: ModelsDevRecord }> {
  const index = new Map<string, { bucket: string; record: ModelsDevRecord }>();
  const preferredBuckets = new Set(Object.values(CATALOG_ALIASES));

  for (const [bucket, provider] of Object.entries(data)) {
    const models = provider?.models;
    if (!models) continue;
    for (const [mkey, record] of Object.entries(models)) {
      const id = String(record.id ?? mkey);
      const entry = { bucket, record };
      for (const k of normKeys(id)) {
        const existing = index.get(k);
        if (!existing) {
          index.set(k, entry);
          continue;
        }
        if (preferredBuckets.has(bucket) && !preferredBuckets.has(existing.bucket)) {
          index.set(k, entry);
        }
      }
      index.set(mkey, entry);
    }
  }
  return index;
}

function lookupInBucket(
  bucket: Record<string, ModelsDevRecord>,
  id: string
): ModelsDevRecord | undefined {
  if (bucket[id]) return bucket[id];
  for (const k of normKeys(id)) {
    if (bucket[k]) return bucket[k];
  }
  return undefined;
}

function stripImpulseProviderPrefix(
  impulseProviderKey: string,
  modelId: string
): string {
  const prefix = `${impulseProviderKey}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

export function enrichModelId(
  impulseProviderKey: string,
  modelId: string,
  catalog: CatalogData,
  apiMeta?: ProviderModelEntry
): ModelInfo {
  const bare = stripImpulseProviderPrefix(impulseProviderKey, modelId);
  const catalogKey = CATALOG_ALIASES[impulseProviderKey] ?? impulseProviderKey;
  const bucket = catalog[catalogKey]?.models;

  let record: ModelsDevRecord | undefined;
  if (bucket) record = lookupInBucket(bucket, bare) ?? lookupInBucket(bucket, modelId);

  if (!record) {
    if (!globalIndex) globalIndex = buildGlobalIndex(catalog);
    for (const k of normKeys(bare)) {
      const hit = globalIndex.get(k);
      if (hit) {
        record = hit.record;
        break;
      }
    }
  }

  let vendor: string;
  let displayName: string;
  const contextTokens =
    record?.limit?.context ??
    apiMeta?.context_length;
  const addedAt = parseAddedAt(record, apiMeta);

  if (record) {
    const pathSeg = bare.includes("/") ? bare.split("/")[0] : undefined;
    vendor = record.family
      ? vendorLabel(record.family)
      : pathSeg
        ? vendorLabel(pathSeg)
        : "—";
    const mdName = record.name ?? bare;
    displayName = isHumanName(mdName, bare) ? mdName : titleCaseSlug(bare);
  } else if (bare.includes("/")) {
    const [v, ...rest] = bare.split("/");
    vendor = vendorLabel(v);
    displayName = isHumanName(rest.join("/"), bare)
      ? rest.join("/")
      : titleCaseSlug(rest.join("/"));
  } else {
    vendor = vendorLabel(bare.split("-")[0]) || "—";
    displayName = titleCaseSlug(bare);
  }

  const info = {
    id: modelId.includes("/") ? modelId : bare,
    vendor,
    displayName,
    contextTokens,
    addedAt,
  };
  return { ...info, pickerLine: formatModelPickerLine(info) };
}

export function sortModelInfos(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const ta = a.addedAt?.getTime() ?? 0;
    const tb = b.addedAt?.getTime() ?? 0;
    if (ta && tb && ta !== tb) return tb - ta;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    const la = `${a.vendor}/${a.displayName}`.toLowerCase();
    const lb = `${b.vendor}/${b.displayName}`.toLowerCase();
    return la.localeCompare(lb);
  });
}

/** Raw model IDs when models.dev enrichment is unavailable. */
export function fallbackModelInfosFromIds(modelIds: string[]): ModelInfo[] {
  return modelIds.map((id) => {
    const info = {
      id,
      vendor: "—",
      displayName: id,
      contextTokens: undefined as number | undefined,
      addedAt: undefined as Date | undefined,
    };
    return { ...info, pickerLine: formatModelPickerLine(info) };
  });
}

export async function enrichDiscoveredModels(
  impulseProviderKey: string,
  modelIds: string[],
  apiEntries?: ProviderModelEntry[]
): Promise<ModelInfo[]> {
  const catalog = await loadModelsDevCatalog();
  const byId = new Map(apiEntries?.map((e) => [e.id, e]) ?? []);

  const infos = modelIds.map((id) =>
    enrichModelId(impulseProviderKey, id, catalog, byId.get(id))
  );
  return sortModelInfos(infos);
}
