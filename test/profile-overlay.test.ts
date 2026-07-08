import { describe, expect, test } from "bun:test";
import type { TUI } from "@mariozechner/pi-tui";
import { ProfileOverlay } from "../src/cli/components/profile-overlay.js";
import type { UserProfile } from "../src/util/config.js";
import {
  assertGutterSafeAcrossWidths,
  stripAnsiAndMarkers,
} from "./helpers/gutter-assertions.js";

/** Minimal stub — Editor only touches tui.requestRender() and tui.terminal.rows. */
function fakeTui(): TUI {
  return {
    requestRender: () => {},
    terminal: { rows: 40 },
  } as unknown as TUI;
}

const profile: UserProfile = {
  name: "Spencer",
  responsePreference: "balanced",
  customInstructions: "Prefer exact file names and avoid emoji in responses.",
};

describe("ProfileOverlay view mode", () => {
  test("gutter-safe across narrow widths", () => {
    assertGutterSafeAcrossWidths((width) =>
      new ProfileOverlay({ tui: fakeTui(), profile }).render(width)
    );
  });

  test("shows all three actions including edit instructions", () => {
    const overlay = new ProfileOverlay({ tui: fakeTui(), profile });
    const plain = overlay.render(80).map(stripAnsiAndMarkers);
    expect(plain.some((l) => l.includes("Edit profile"))).toBe(true);
    expect(plain.some((l) => l.includes("Edit instructions"))).toBe(true);
    expect(plain.some((l) => l.includes("Close"))).toBe(true);
  });
});

describe("ProfileOverlay inline instructions editor", () => {
  test("'i' opens the editor pre-filled with current instructions", () => {
    const overlay = new ProfileOverlay({ tui: fakeTui(), profile });
    overlay.handleInput("i");
    const plain = overlay.render(80).map(stripAnsiAndMarkers);
    expect(plain.some((l) => l.includes("Edit custom instructions"))).toBe(true);
    expect(plain.some((l) => l.includes("Prefer exact file names"))).toBe(true);
  });

  test("editor rendering stays gutter-safe across narrow widths", () => {
    assertGutterSafeAcrossWidths((width) => {
      const overlay = new ProfileOverlay({ tui: fakeTui(), profile });
      overlay.handleInput("i");
      return overlay.render(width);
    });
  });

  test("Ctrl+S saves the edited text via onSaveInstructions", () => {
    const overlay = new ProfileOverlay({ tui: fakeTui(), profile });
    let saved: string | null = null;
    overlay.onSaveInstructions = (text) => {
      saved = text;
    };
    overlay.handleInput("i");
    for (const ch of " Also prefer tabs.") overlay.handleInput(ch);
    overlay.handleInput("\x13"); // Ctrl+S
    expect(saved).toBe(
      "Prefer exact file names and avoid emoji in responses. Also prefer tabs."
    );
    // Back in view mode — no stray editor chrome.
    const plain = overlay.render(80).map(stripAnsiAndMarkers);
    expect(plain.some((l) => l.includes("Edit custom instructions"))).toBe(false);
  });

  test("Esc discards in-progress edits", () => {
    const overlay = new ProfileOverlay({ tui: fakeTui(), profile });
    let saveCalled = false;
    overlay.onSaveInstructions = () => {
      saveCalled = true;
    };
    overlay.handleInput("i");
    overlay.handleInput("x");
    overlay.handleInput("\x1b"); // Esc
    expect(saveCalled).toBe(false);
    const plain = overlay.render(80).map(stripAnsiAndMarkers);
    expect(plain.some((l) => l.includes("Edit custom instructions"))).toBe(false);
    expect(plain.some((l) => l.includes("Prefer exact file names"))).toBe(true);
  });
});
