import { describe, expect, test } from "bun:test";
import {
  applyTitlePolicy,
  clampGeneratedTitle,
  isWeakHeaderTitle,
  makeTitleUnique,
  normalizeTitle,
  TITLE_MAX_LENGTH,
  titlesOverlap,
} from "../src/util/title-policy.js";
import {
  acceptRetitle,
  countUserTurns,
  decideTitleAction,
  lastTurnWasSubstantive,
} from "../src/session/title-decision.js";
import type { Message } from "../src/session/store.js";

function user(content: string, injected = false): Message {
  return {
    role: "user",
    content,
    timestamp: new Date().toISOString(),
    ...(injected ? { injected: true } : {}),
  };
}

function assistant(content: string, toolCalls = 0): Message {
  return {
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    ...(toolCalls > 0
      ? {
          tool_calls: Array.from({ length: toolCalls }, (_, i) => ({
            id: `call_${i}`,
            type: "function" as const,
            function: { name: "file_read", arguments: "{}" },
          })),
        }
      : {}),
  };
}

function toolResult(content = "ok"): Message {
  return {
    role: "tool",
    content,
    tool_call_id: "call_0",
    timestamp: new Date().toISOString(),
  };
}

describe("title hard cap", () => {
  test("cap is materially lower than the former 60", () => {
    expect(TITLE_MAX_LENGTH).toBe(40);
  });

  test("clamps to whole words inside the cap", () => {
    const long = "Refactor the session title generation pipeline completely";
    const clamped = clampGeneratedTitle(long);
    expect(clamped.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(clamped).toBe("Refactor the session title generation");
    expect(clamped.endsWith(" ")).toBe(false);
  });

  test("clamps a single over-long token by character", () => {
    const clamped = clampGeneratedTitle("a".repeat(80));
    expect(clamped).toHaveLength(TITLE_MAX_LENGTH);
  });

  test("leaves short titles untouched", () => {
    expect(clampGeneratedTitle("DeepSeek model id fix")).toBe(
      "DeepSeek model id fix"
    );
  });
});

describe("weak and generic title rejection", () => {
  test("rejects the previously-accepted weak forms", () => {
    for (const bad of ["", "  ", "12", "# 625", "1, 2, 3", "a"]) {
      expect(isWeakHeaderTitle(bad)).toBe(true);
    }
  });

  test("rejects generic labels that the old gate allowed", () => {
    for (const generic of [
      "Code help",
      "Question",
      "Discussion",
      "Help",
      "Chat",
      "Session",
      "New session",
      "Untitled",
      "Code",
      "Testing",
    ]) {
      expect(isWeakHeaderTitle(generic)).toBe(true);
    }
  });

  test("rejects one-word and six-plus-word labels", () => {
    expect(isWeakHeaderTitle("Refactor")).toBe(true);
    expect(
      isWeakHeaderTitle("Refactor the entire session title generation pipeline")
    ).toBe(true);
  });

  test("accepts specific two-to-five word titles", () => {
    for (const good of [
      "Heartbeat reconnect loop",
      "DeepSeek model id fix",
      "Round 2 smoke test",
      "Session title policy",
    ]) {
      expect(isWeakHeaderTitle(good)).toBe(false);
    }
  });

  test("normalizes wrapping artifacts before judging", () => {
    expect(normalizeTitle('## "Session title policy"')).toBe("Session title policy");
    expect(isWeakHeaderTitle("# DeepSeek model id fix")).toBe(false);
  });
});

describe("uniqueness", () => {
  test("leaves a non-colliding title alone", () => {
    expect(makeTitleUnique("DeepSeek model id fix", ["Other session"])).toBe(
      "DeepSeek model id fix"
    );
  });

  test("appends a deterministic numeric discriminator on collision", () => {
    const taken = ["Session title policy"];
    expect(makeTitleUnique("Session title policy", taken)).toBe(
      "Session title policy (2)"
    );
    expect(makeTitleUnique("Session title policy", taken)).toBe(
      "Session title policy (2)"
    );
  });

  test("skips suffixes already in use", () => {
    const taken = ["Session title policy", "Session title policy (2)"];
    expect(makeTitleUnique("Session title policy", taken)).toBe(
      "Session title policy (3)"
    );
  });

  test("collision match is case-insensitive", () => {
    expect(makeTitleUnique("Session title policy", ["session TITLE policy"])).toBe(
      "Session title policy (2)"
    );
  });

  test("disambiguated result still respects the cap", () => {
    // Exactly at the cap, so the " (2)" suffix must displace the tail.
    const base = "Refactor the session title generationxxx";
    expect(base.length).toBe(TITLE_MAX_LENGTH);

    const unique = makeTitleUnique(base, [base]);
    expect(unique.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(unique.endsWith("(2)")).toBe(true);
    expect(unique).not.toBe(base);
  });

  test("applyTitlePolicy returns the disambiguated title", () => {
    const result = applyTitlePolicy("Session title policy", [
      "Session title policy",
    ]);
    expect(result.ok).toBe(true);
    expect(result.title).toBe("Session title policy (2)");
  });

  test("applyTitlePolicy rejects an over-cap candidate", () => {
    const result = applyTitlePolicy(
      "Refactor the entire session title generation pipeline"
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(String(TITLE_MAX_LENGTH));
  });
});

describe("topic overlap", () => {
  test("same topic overlaps", () => {
    expect(
      titlesOverlap("Session title policy", "Session title policy rework")
    ).toBe(true);
  });

  test("different topic does not overlap", () => {
    expect(titlesOverlap("Session title policy", "Heartbeat reconnect loop")).toBe(
      false
    );
  });

  test("acceptRetitle replaces only on a topic shift", () => {
    expect(acceptRetitle("Session title policy", null)).toBeNull();
    expect(acceptRetitle("Session title policy", "Session title policy")).toBeNull();
    expect(
      acceptRetitle("Session title policy", "Session title policy rework")
    ).toBeNull();
    expect(
      acceptRetitle("Session title policy", "Heartbeat reconnect loop")
    ).toBe("Heartbeat reconnect loop");
  });
});

describe("turn counting and substantive detection", () => {
  test("ignores injected system notes", () => {
    expect(countUserTurns([user("hi"), user("[System] note", true)])).toBe(1);
  });

  test("substantive when the turn called a tool", () => {
    expect(
      lastTurnWasSubstantive([user("go"), assistant("", 1), toolResult()])
    ).toBe(true);
  });

  test("substantive when the reply is long enough", () => {
    expect(lastTurnWasSubstantive([user("go"), assistant("x".repeat(80))])).toBe(
      true
    );
  });

  test("not substantive for a short reply with no tools", () => {
    expect(lastTurnWasSubstantive([user("go"), assistant("sure!")])).toBe(false);
  });
});

describe("title action policy", () => {
  const substantiveTurn = [user("first"), assistant("ok"), user("second"), assistant("", 1), toolResult()];

  test("waits for the second user turn", () => {
    expect(
      decideTitleAction({ messages: [user("only one"), assistant("", 1), toolResult()] })
    ).toEqual({ action: "skip" });
  });

  test("generates on the second substantive turn", () => {
    expect(decideTitleAction({ messages: substantiveTurn })).toEqual({
      action: "generate",
      userTurns: 2,
    });
  });

  test("waits when the second turn was not substantive", () => {
    expect(
      decideTitleAction({
        messages: [user("first"), assistant("ok"), user("second"), assistant("sure!")],
      })
    ).toEqual({ action: "skip" });
  });

  test("reconsiders only at the 10-turn boundary", () => {
    const nine = Array.from({ length: 9 }, (_, i) => [user(`u${i}`), assistant("", 1), toolResult()]).flat();
    expect(
      decideTitleAction({
        messages: nine,
        currentTitle: "Session title policy",
        meta: { source: "auto", lastTitleUserTurns: 2 },
      })
    ).toEqual({ action: "skip" });

    const ten = [...nine, user("u10"), assistant("", 1), toolResult()];
    expect(
      decideTitleAction({
        messages: ten,
        currentTitle: "Session title policy",
        meta: { source: "auto", lastTitleUserTurns: 2 },
      })
    ).toEqual({ action: "reconsider", userTurns: 10 });
  });

  test("stops re-titling after the cap", () => {
    const ten = Array.from({ length: 10 }, (_, i) => [user(`u${i}`), assistant("", 1), toolResult()]).flat();
    expect(
      decideTitleAction({
        messages: ten,
        currentTitle: "Session title policy",
        meta: { source: "auto", lastTitleUserTurns: 2, retitleCount: 3 },
      })
    ).toEqual({ action: "skip" });
  });

  test("does not reconsider a manually-set title", () => {
    const ten = Array.from({ length: 10 }, (_, i) => [user(`u${i}`), assistant("", 1), toolResult()]).flat();
    expect(
      decideTitleAction({
        messages: ten,
        currentTitle: "Hand-picked title",
        meta: { source: "manual" },
      })
    ).toEqual({ action: "skip" });
  });

  test("does not reconsider twice at the same boundary", () => {
    const ten = Array.from({ length: 10 }, (_, i) => [user(`u${i}`), assistant("", 1), toolResult()]).flat();
    expect(
      decideTitleAction({
        messages: ten,
        currentTitle: "Session title policy",
        meta: { source: "auto", lastTitleUserTurns: 10 },
      })
    ).toEqual({ action: "skip" });
  });

  test("pre-policy sessions with a title are still eligible for reconsideration", () => {
    const ten = Array.from({ length: 10 }, (_, i) => [user(`u${i}`), assistant("", 1), toolResult()]).flat();
    expect(
      decideTitleAction({
        messages: ten,
        currentTitle: "Legacy generated title",
        meta: { lastTitleUserTurns: 1 },
      })
    ).toEqual({ action: "reconsider", userTurns: 10 });
  });
});
