import { describe, expect, test } from "bun:test";
import {
  buildProviderGroupedRows,
  isManualModelRow,
  manualRowProviderKey,
  MANUAL_MODEL_ROW_PREFIX,
} from "../src/cli/components/model-picker-overlay.js";
import { TextInputOverlay } from "../src/cli/components/text-input-overlay.js";
import type { ModelInfo } from "../src/cli/model-catalog.js";

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
