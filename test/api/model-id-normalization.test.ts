import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { parseModelString, PROVIDER_PREFIXES } from "../../src/api/manager.js";

/**
 * Provider clients receive `CompletionOptions.model` verbatim and forward it
 * upstream, so only the bare model id may ever reach them. DeepSeek rejects the
 * prefixed form outright:
 *
 *   400 The supported API model names are deepseek-flash, deepseek-v4-pro,
 *   but you passed deepseek/deepseek-flash.
 */
describe("parseModelString strips custom provider prefixes", () => {
  test("strips a configured custom provider prefix", () => {
    const parsed = parseModelString("deepseek/deepseek-flash", "deepseek");
    expect(parsed.provider).toBe("deepseek");
    expect(parsed.model).toBe("deepseek-flash");
  });

  test("strips a custom provider prefix even when another provider is default", () => {
    const parsed = parseModelString("deepseek/deepseek-flash", "z.ai");
    expect(parsed.provider).toBe("deepseek");
    expect(parsed.model).toBe("deepseek-flash");
  });

  test("strips a custom prefix that carries a nested model id", () => {
    const parsed = parseModelString("openrouter/anthropic/claude-haiku-4.5", "z.ai");
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.model).toBe("anthropic/claude-haiku-4.5");
  });

  test("leaves an unprefixed model on the default provider", () => {
    const parsed = parseModelString("deepseek-flash", "deepseek");
    expect(parsed.provider).toBe("deepseek");
    expect(parsed.model).toBe("deepseek-flash");
  });

  test("keeps the known-provider prefix list in sync with deepseek support", () => {
    expect(PROVIDER_PREFIXES).toContain("deepseek");
  });
});

// ─── Regression guard ────────────────────────────────────────────────────────
// The original defect was a call-site mistake: `getProvider(model).complete()`
// hands the prefixed id straight to the provider client, bypassing the
// manager's normalization. These assertions fail if that pattern comes back.

const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function sourceLines(): Array<{ file: string; line: number; text: string }> {
  const lines: Array<{ file: string; line: number; text: string }> = [];
  for (const file of walk(SRC)) {
    readFileSync(file, "utf-8")
      .split("\n")
      .forEach((text, i) => lines.push({ file, line: i + 1, text }));
  }
  return lines;
}

describe("provider calls route through manager model resolution", () => {
  test("no bare getProvider(model).complete()/stream() call sites remain", () => {
    const offenders = sourceLines()
      .filter(({ text }) => /getProvider\([^)]*\)\s*\.\s*(complete|stream)\s*\(/.test(text))
      .map(({ file, line, text }) => `${path.relative(SRC, file)}:${line} — ${text.trim()}`);

    expect(offenders).toEqual([]);
  });

  test("side calls resolving a provider directly also resolve the bare model id", () => {
    // Sites that need the provider object itself (vision discovery/probe, goal
    // judge) must destructure the bare id rather than reuse the prefixed input.
    const lines = sourceLines();
    const helperUsers = lines.filter(({ file }) =>
      /[\\/](goal-loop|loop)\.ts$/.test(file)
    );
    const destructures = helperUsers.filter(({ text }) =>
      /resolveModel\(/.test(text)
    );

    expect(destructures.length).toBeGreaterThan(0);
    for (const { file, line, text } of destructures) {
      expect(`${path.relative(SRC, file)}:${line} ${text}`).toMatch(
        /model:\s*\w+/
      );
    }
  });
});
