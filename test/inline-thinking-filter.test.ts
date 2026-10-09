import { describe, expect, test } from "bun:test";
import { InlineThinkingFilter } from "../src/util/inline-thinking-filter.js";

function feed(deltas: string[]): { content: string; thinking: string } {
  const filter = new InlineThinkingFilter();
  let content = "";
  let thinking = "";
  for (const d of deltas) {
    const out = filter.push(d);
    content += out.content;
    thinking += out.thinking;
  }
  const flushed = filter.flush();
  content += flushed.content;
  thinking += flushed.thinking;
  return { content, thinking };
}

describe("InlineThinkingFilter", () => {
  test("prose without tags passes through unchanged", () => {
    expect(feed(["Hello ", "world!"])).toEqual({
      content: "Hello world!",
      thinking: "",
    });
  });

  test("angle brackets in prose are not eaten", () => {
    expect(feed(["1 < 3 and 5 > 2"])).toEqual({
      content: "1 < 3 and 5 > 2",
      thinking: "",
    });
  });

  test("full envelope routed to thinking, prose kept", () => {
    const out = feed(["<think>plan the answer</think>", "Here it is."]);
    expect(out.thinking).toBe("plan the answer");
    expect(out.content).toBe("Here it is.");
  });

  test("envelope split across many deltas", () => {
    const out = feed(["<th", "ink>reas", "oning ", "here</thi", "nk>Answer!"]);
    expect(out.thinking).toBe("reasoning here");
    expect(out.content).toBe("Answer!");
  });

  test("prose before envelope is kept in order", () => {
    const out = feed(["First. <think>hm</think> Second."]);
    expect(out.content).toBe("First.  Second.");
    expect(out.thinking).toBe("hm");
  });

  test("multiple envelopes in one stream", () => {
    const out = feed(["<think>a</think>one<think>b</think>two"]);
    expect(out.thinking).toBe("ab");
    expect(out.content).toBe("onetwo");
  });

  test("thinking and reasoning tag variants", () => {
    expect(feed(["<thinking>x</thinking>ok"])).toEqual({
      content: "ok",
      thinking: "x",
    });
    expect(feed(["<reasoning>y</reasoning>ok"])).toEqual({
      content: "ok",
      thinking: "y",
    });
  });

  test("unclosed envelope at stream end stays thinking", () => {
    const out = feed(["<think>half-way through a thought"]);
    expect(out.thinking).toBe("half-way through a thought");
    expect(out.content).toBe("");
  });

  test("partial tag that never completes flushes as prose", () => {
    const out = feed(["plain <th", "at was all"]);
    expect(out.content).toBe("plain <that was all");
    expect(out.thinking).toBe("");
  });

  test("split closing tag across deltas", () => {
    const out = feed(["<think>abc</th", "ink>done"]);
    expect(out.thinking).toBe("abc");
    expect(out.content).toBe("done");
  });

  test("empty deltas are no-ops", () => {
    const filter = new InlineThinkingFilter();
    expect(filter.push("")).toEqual({ content: "", thinking: "" });
  });
});
