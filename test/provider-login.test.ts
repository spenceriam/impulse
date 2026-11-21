import { describe, expect, test } from "bun:test";
import {
  buildProviderLoginRows,
  parseProviderLoginRow,
  PROVIDER_LOGIN_ROW_PREFIX,
} from "../src/cli/provider-login.js";

describe("provider login rows", () => {
  const providers = [
    { key: "ollama", label: "Ollama Cloud", hasKey: true, modelCount: 7 },
    { key: "openrouter", label: "OpenRouter", hasKey: true, modelCount: 312 },
    { key: "deepseek", label: "DeepSeek", hasKey: false, modelCount: null },
  ];

  test("one row per provider with key state and model count", () => {
    const rows = buildProviderLoginRows(providers);
    expect(rows.map((r) => r.id)).toEqual([
      `${PROVIDER_LOGIN_ROW_PREFIX}ollama`,
      `${PROVIDER_LOGIN_ROW_PREFIX}openrouter`,
      `${PROVIDER_LOGIN_ROW_PREFIX}deepseek`,
    ]);
    expect(rows[0]!.tableCells?.model).toBe("● set");
    expect(rows[2]!.tableCells?.model).toBe("○ not set");
  });

  test("model count renders as a number, or a dash when unknown", () => {
    const rows = buildProviderLoginRows(providers);
    expect(rows[1]!.tableCells?.mode).toBe("312");
    expect(rows[2]!.tableCells?.mode).toBe("—");
  });

  test("a row id round-trips to its provider key", () => {
    const rows = buildProviderLoginRows(providers);
    expect(parseProviderLoginRow(rows[0]!.id)).toBe("ollama");
  });

  test("a non-login row id parses to null", () => {
    expect(parseProviderLoginRow("something-else")).toBeNull();
  });

  test("no providers yields no rows", () => {
    expect(buildProviderLoginRows([])).toEqual([]);
  });
});
