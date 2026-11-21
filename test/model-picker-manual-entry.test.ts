import { describe, expect, test } from "bun:test";
import {
  buildProviderGroupedRows,
  isManualModelRow,
  manualRowProviderKey,
  MANUAL_MODEL_ROW_PREFIX,
  capabilityTags,
  modelInfoToTableCells,
} from "../src/cli/components/model-picker-overlay.js";
import { TextInputOverlay } from "../src/cli/components/text-input-overlay.js";
import { parseMaxTokensCapError } from "../src/agent/loop.js";
import type { ModelInfo } from "../src/cli/model-catalog.js";
import { clearModelCapabilities, setModelCapabilities } from "../src/api/capabilities.js";

function info(id: string): ModelInfo {
  return { id, vendor: "MiniMax", displayName: id } as ModelInfo;
}

describe("model picker manual entry rows (#159)", () => {
  test("each provider group ends with a manual model id row", () => {
    const rows = buildProviderGroupedRows([
      { providerKey: "minimax-token-plan", label: "minimax-token-plan", infos: [info("MiniMax-M3")] },
      { providerKey: "ollama", label: "ollama", infos: [info("deepseek-v4.1-flash")] },
    ]);

    const manualRows = rows.filter((r) => isManualModelRow(r.id));
    expect(manualRows.map((r) => manualRowProviderKey(r.id)).sort()).toEqual([
      "minimax-token-plan",
      "ollama",
    ]);
    expect(manualRows.every((r) => r.label.includes("custom model id"))).toBe(true);
  });

  test("manual row helpers round-trip provider keys", () => {
    expect(isManualModelRow(`${MANUAL_MODEL_ROW_PREFIX}minimax-token-plan`)).toBe(true);
    expect(isManualModelRow("minimax-token-plan\0MiniMax-M3")).toBe(false);
    expect(manualRowProviderKey(`${MANUAL_MODEL_ROW_PREFIX}minimax-token-plan`)).toBe(
      "minimax-token-plan"
    );
  });
});

describe("model picker context column (#159)", () => {
  test("picker cell shows context window only — output caps stay internal", () => {
    const cells = modelInfoToTableCells({
      id: "MiniMax-M3",
      vendor: "MiniMax",
      displayName: "MiniMax M3",
      contextTokens: 1_000_000,
      maxOutputTokens: 524_288,
    } as ModelInfo);
    expect(cells.mode).toBe("1m");
  });

  test("picker cell shows context alone when output unknown", () => {
    const cells = modelInfoToTableCells({
      id: "x",
      vendor: "—",
      displayName: "x",
      contextTokens: 204_800,
    } as ModelInfo);
    expect(cells.mode).toBe("205k");
  });
});

describe("parseMaxTokensCapError (#159)", () => {
  test("extracts the cap from MiniMax-style rejections", () => {
    expect(
      parseMaxTokensCapError(
        new Error(
          'invalid params, model[MiniMax-M3] does not support max tokens > 524288 (2013)'
        )
      )
    ).toBe(524288);
    expect(parseMaxTokensCapError(new Error("max_tokens is too large: 8192 tokens > 4096"))).toBe(
      4096
    );
  });

  test("non-cap errors return null", () => {
    expect(parseMaxTokensCapError(new Error("rate limited"))).toBeNull();
    expect(parseMaxTokensCapError(new Error("connection reset"))).toBeNull();
  });
});

describe("TextInputOverlay", () => {
  function makeOverlay() {
    const overlay = new TextInputOverlay({
      title: "Custom model id",
      description: "desc",
      placeholder: "MiniMax-M3.1-Flash-Preview",
    });
    return { overlay };
  }

  test("typing, backspace, enter submit trimmed value", () => {
    const { overlay } = makeOverlay();
    let submitted: string | null = null;
    overlay.onSubmit = (v) => {
      submitted = v;
    };

    for (const ch of "MiniMax-M3.1-Flash-Preview") overlay.handleInput(ch);
    overlay.handleInput("\x7f"); // drop trailing "w" -> ...Previe
    overlay.handleInput("X");
    overlay.handleInput("\r");

    expect(submitted).toBe("MiniMax-M3.1-Flash-PrevieX");
  });

  test("empty input does not submit; escape cancels", () => {
    const { overlay } = makeOverlay();
    let submitted = false;
    let cancelled = false;
    overlay.onSubmit = () => {
      submitted = true;
    };
    overlay.onCancel = () => {
      cancelled = true;
    };

    overlay.handleInput(" ");
    overlay.handleInput("\r");
    expect(submitted).toBe(false);

    overlay.handleInput("\x1b");
    expect(cancelled).toBe(true);
  });

  test("kitty-encoded enter and escape work", () => {
    const { overlay } = makeOverlay();
    let cancelled = false;
    let submitted: string | null = null;
    overlay.onCancel = () => {
      cancelled = true;
    };
    overlay.onSubmit = (v) => {
      submitted = v;
    };

    overlay.handleInput("\x1b[27u");
    expect(cancelled).toBe(true);

    for (const ch of "abc") overlay.handleInput(ch);
    overlay.handleInput("\x1b[13u");
    expect(submitted).toBe("abc");
  });
});

describe("model picker capability column (#159)", () => {
  test("vision-capable model shows a v tag", () => {
    setModelCapabilities("vision-model", {
      vision: true,
      reasoning: false,
      discoveredAt: Date.now(),
      source: "provider-api",
    });
    expect(capabilityTags("vision-model")).toBe("v");
    clearModelCapabilities("vision-model");
  });

  test("reasoning model shows an r tag", () => {
    setModelCapabilities("reasoning-model", {
      vision: false,
      reasoning: true,
      discoveredAt: Date.now(),
      source: "provider-api",
    });
    expect(capabilityTags("reasoning-model")).toBe("r");
    clearModelCapabilities("reasoning-model");
  });

  test("unknown capabilities render as an em dash, not a guess", () => {
    const cells = modelInfoToTableCells({
      id: "totally-unknown-model-xyz",
      vendor: "—",
      displayName: "x",
    } as ModelInfo);
    expect(cells.model === "—" || cells.model === "").toBe(true);
  });
});
