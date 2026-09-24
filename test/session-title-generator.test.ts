import { describe, expect, test } from "bun:test";
import { cleanGeneratedTitleText } from "../src/session/title-generator.js";
import {
  clampGeneratedTitle,
  isWeakHeaderTitle,
  TITLE_GEN_MAX_TOKENS,
  TITLE_MAX_LENGTH,
} from "../src/util/title-policy.js";

const OPENCODE_OPEN = "<" + "redacted_thinking" + ">";
const OPENCODE_CLOSE = "</" + "redacted_thinking" + ">";

describe("TITLE_GEN_MAX_TOKENS", () => {
  test("gen ceiling is far above the display clamp", () => {
    expect(TITLE_GEN_MAX_TOKENS).toBe(1024);
    expect(TITLE_GEN_MAX_TOKENS).toBeGreaterThan(TITLE_MAX_LENGTH);
  });
});

describe("cleanGeneratedTitleText", () => {
  test("strips think/thinking/reasoning tag envelopes before the real title", () => {
    const raw =
      "<think>\nWrong scratchpad title\n</think>\nDeepSeek model id fix";
    expect(cleanGeneratedTitleText(raw)).toBe("DeepSeek model id fix");

    const thinking =
      "<thinking>internal note</thinking>\nHeartbeat reconnect loop";
    expect(cleanGeneratedTitleText(thinking)).toBe("Heartbeat reconnect loop");

    const reasoning =
      "<reasoning>plan</reasoning>\nSession title policy";
    expect(cleanGeneratedTitleText(reasoning)).toBe("Session title policy");
  });

  test("strips ```thinking fences before the real title", () => {
    const raw =
      "```thinking\nI should name this carefully\n```\nDeepSeek model id fix";
    expect(cleanGeneratedTitleText(raw)).toBe("DeepSeek model id fix");
  });

  test("strips OpenCode redacted_thinking blocks before the real title", () => {
    const raw =
      `${OPENCODE_OPEN}\nmid-thought prose dump\n${OPENCODE_CLOSE}\nHeartbeat reconnect loop`;
    expect(cleanGeneratedTitleText(raw)).toBe("Heartbeat reconnect loop");
  });

  test("drops orphan OpenCode close — content before the close is thinking", () => {
    const raw = `mid-thought dump${OPENCODE_CLOSE}\nDeepSeek model id fix`;
    expect(cleanGeneratedTitleText(raw)).toBe("DeepSeek model id fix");
  });

  test("unclosed thinking dump yields empty", () => {
    expect(cleanGeneratedTitleText("<think>\nstill reasoning about")).toBe("");
    expect(
      cleanGeneratedTitleText(`${OPENCODE_OPEN}\nstill reasoning about`)
    ).toBe("");
    expect(cleanGeneratedTitleText("```thinking\nstill going")).toBe("");
  });

  test("drops leading thinking-process prose; preamble-only is empty", () => {
    expect(
      cleanGeneratedTitleText("Thinking process:\nDeepSeek model id fix")
    ).toBe("DeepSeek model id fix");
    expect(
      cleanGeneratedTitleText("Here's my reasoning process:\nHeartbeat reconnect loop")
    ).toBe("Heartbeat reconnect loop");
    expect(cleanGeneratedTitleText("Thinking process:")).toBe("");
    expect(cleanGeneratedTitleText("Here's a thinking process:")).toBe("");
  });

  test("applies quote and prefix cleanup after thinking strip", () => {
    expect(cleanGeneratedTitleText('"Title: DeepSeek model id fix"')).toBe(
      "DeepSeek model id fix"
    );
    expect(cleanGeneratedTitleText("Session: Heartbeat reconnect loop")).toBe(
      "Heartbeat reconnect loop"
    );
  });

  test("thinking-dump content cleans to empty or weak; short real title clamps", () => {
    const dump = cleanGeneratedTitleText(
      `${OPENCODE_OPEN}\nThe user wants a title. I will consider options. Considering the login button on mobile is broken and I need a short phrase.${OPENCODE_CLOSE}`
    );
    expect(dump).toBe("");

    const midThought = cleanGeneratedTitleText(
      "The user is asking me to carefully consider what the best session title would be for this particular exchange about refactoring"
    );
    const clampedThought = clampGeneratedTitle(midThought);
    // Survives cleaning as prose, but fails the word-band / quality gate.
    expect(isWeakHeaderTitle(clampedThought)).toBe(true);

    const real = cleanGeneratedTitleText("DeepSeek model id fix");
    expect(clampGeneratedTitle(real)).toBe("DeepSeek model id fix");
    expect(clampGeneratedTitle(real).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(isWeakHeaderTitle(clampGeneratedTitle(real))).toBe(false);
  });
});
