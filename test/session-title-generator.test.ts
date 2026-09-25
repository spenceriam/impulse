import { describe, expect, test } from "bun:test";
import {
  cleanGeneratedTitleText,
  formatRejectedTitleForLog,
  formatTitleRejectLogMessage,
  TITLE_REJECT_LOG_MAX,
} from "../src/session/title-generator.js";
import {
  clampGeneratedTitle,
  isWeakHeaderTitle,
  TITLE_GEN_MAX_TOKENS,
  TITLE_MAX_LENGTH,
} from "../src/util/title-policy.js";

const OPENCODE_OPEN = "<" + "redacted_thinking" + ">";
const OPENCODE_CLOSE = "</" + "redacted_thinking" + ">";

function acceptCleaned(raw: string): string {
  const cleaned = cleanGeneratedTitleText(raw);
  const clamped = clampGeneratedTitle(cleaned);
  expect(clamped.length).toBeGreaterThan(0);
  expect(isWeakHeaderTitle(clamped)).toBe(false);
  return clamped;
}

describe("TITLE_GEN_MAX_TOKENS", () => {
  test("gen ceiling is far above the display clamp", () => {
    expect(TITLE_GEN_MAX_TOKENS).toBe(1024);
    expect(TITLE_GEN_MAX_TOKENS).toBeGreaterThan(TITLE_MAX_LENGTH);
  });
});

describe("cleanGeneratedTitleText", () => {
  test("strips think/thinking/reasoning tag envelopes before the real title", () => {
    expect(
      acceptCleaned("<think>\nWrong scratchpad title\n</think>\nDeepSeek model id fix")
    ).toBe("DeepSeek model id fix");
    expect(
      acceptCleaned("<thinking>internal note</thinking>\nHeartbeat reconnect loop")
    ).toBe("Heartbeat reconnect loop");
    expect(
      acceptCleaned("<reasoning>plan</reasoning>\nSession title policy")
    ).toBe("Session title policy");
  });

  test("strips ```thinking fences before the real title", () => {
    expect(
      acceptCleaned(
        "```thinking\nI should name this carefully\n```\nDeepSeek model id fix"
      )
    ).toBe("DeepSeek model id fix");
  });

  test("strips OpenCode redacted_thinking blocks before the real title", () => {
    expect(
      acceptCleaned(
        `${OPENCODE_OPEN}\nmid-thought prose dump\n${OPENCODE_CLOSE}\nHeartbeat reconnect loop`
      )
    ).toBe("Heartbeat reconnect loop");
  });

  test("drops orphan OpenCode close — content before the close is thinking", () => {
    expect(
      acceptCleaned(`mid-thought dump${OPENCODE_CLOSE}\nDeepSeek model id fix`)
    ).toBe("DeepSeek model id fix");
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
      acceptCleaned("Thinking process:\nDeepSeek model id fix")
    ).toBe("DeepSeek model id fix");
    expect(
      acceptCleaned("Here's my reasoning process:\nHeartbeat reconnect loop")
    ).toBe("Heartbeat reconnect loop");
    expect(cleanGeneratedTitleText("Thinking process:")).toBe("");
    expect(cleanGeneratedTitleText("Here's a thinking process:")).toBe("");
  });

  test("salvages title after unmarked thinking prose (Defiant dogfood failure mode)", () => {
    expect(
      acceptCleaned(
        "The user wants a session title. Looking at the conversation about fixing DeepSeek model ids. DeepSeek model id fix"
      )
    ).toBe("DeepSeek model id fix");

    expect(
      acceptCleaned(
        "Okay, I need to generate a 2-5 word title. The topic is GLM title generation budget.\nGLM title gen budget"
      )
    ).toBe("GLM title gen budget");

    expect(
      acceptCleaned("I should create a short title for this. Heartbeat reconnect loop")
    ).toBe("Heartbeat reconnect loop");

    expect(
      acceptCleaned(
        "Let me think about what this conversation is about. They are fixing session title generation.\nSession title gen fix"
      )
    ).toBe("Session title gen fix");

    expect(
      acceptCleaned(
        "Based on the messages, a good title would be: Title policy word band"
      )
    ).toBe("Title policy word band");

    expect(
      acceptCleaned("Here is a good title:\nDeepSeek model id fix")
    ).toBe("DeepSeek model id fix");

    expect(
      acceptCleaned(
        "Considering the conversation:\nThe login button is broken on mobile devices and needs a fix.\nLogin button mobile fix"
      )
    ).toBe("Login button mobile fix");
  });

  test("applies quote and Title: prefix cleanup after thinking strip", () => {
    expect(acceptCleaned('"Title: DeepSeek model id fix"')).toBe(
      "DeepSeek model id fix"
    );
    expect(acceptCleaned("Session: Heartbeat reconnect loop")).toBe(
      "Heartbeat reconnect loop"
    );
    // "Session " without a colon must NOT strip — that is part of the title.
    expect(acceptCleaned("Session title gen fix")).toBe("Session title gen fix");
  });

  test("pure unmarked meta prose stays weak after clamp (logged, not forced)", () => {
    const cleaned = cleanGeneratedTitleText(
      "The user is asking me to carefully consider what the best session title would be for this particular exchange about refactoring"
    );
    const clamped = clampGeneratedTitle(cleaned);
    expect(isWeakHeaderTitle(clamped)).toBe(true);
  });

  test("short real title clamps cleanly", () => {
    const real = cleanGeneratedTitleText("DeepSeek model id fix");
    expect(clampGeneratedTitle(real)).toBe("DeepSeek model id fix");
    expect(clampGeneratedTitle(real).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(isWeakHeaderTitle(clampGeneratedTitle(real))).toBe(false);
  });

  test("markdown leftovers in model output normalize to plain titles", () => {
    expect(
      acceptCleaned("2. **Storage snapshots** as a")
    ).toBe("Storage snapshots as a");
    expect(acceptCleaned("WAL + periodic snapshots**")).toBe(
      "WAL + periodic snapshots"
    );
    expect(acceptCleaned("`DeepSeek model id fix`")).toBe("DeepSeek model id fix");
  });
});

describe("title reject logging", () => {
  test("includes truncated rejected cleaned title text", () => {
    const msg = formatTitleRejectLogMessage("weak or empty after clamp", {
      finishReason: "stop",
      usage: {
        prompt_tokens: 135,
        completion_tokens: 39,
        total_tokens: 174,
      },
      rejected: "The user wants a session title. Looking",
    });
    expect(msg).toContain("weak or empty after clamp");
    expect(msg).toContain("finish_reason=stop");
    expect(msg).toContain("usage=prompt:135 completion:39 total:174");
    expect(msg).toContain(
      'rejected="The user wants a session title. Looking"'
    );
  });

  test("empty reject logs rejected=\"\" and optional raw preview", () => {
    const msg = formatTitleRejectLogMessage("empty after thinking cleanup", {
      finishReason: "stop",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
      rejected: "",
      raw: "<think>\nstill going with no title",
    });
    expect(msg).toContain('rejected=""');
    expect(msg).toContain("raw=");
    expect(msg).toContain("still going");
  });

  test("formatRejectedTitleForLog truncates long text safely", () => {
    const long = "x".repeat(TITLE_REJECT_LOG_MAX + 40);
    const formatted = formatRejectedTitleForLog(long);
    expect(formatted).toBeDefined();
    expect(formatted!.startsWith("rejected=")).toBe(true);
    expect(formatted!.endsWith('…"')).toBe(true);
    expect(formatted!.length).toBeLessThan(long.length + 20);
  });
});
