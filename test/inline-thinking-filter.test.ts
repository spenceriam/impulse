import { describe, expect, test } from "bun:test";
import { InlineThinkingFilter } from "../src/util/inline-thinking-filter.js";

function feed(deltas: string[]): { prose: string; captured: string } {
  const filter = new InlineThinkingFilter();
  let prose = "";
  let captured = "";
  for (const d of deltas) {
    const out = filter.push(d);
    prose += out.prose;
    captured += out.captured;
  }
  const flushed = filter.flush();
  prose += flushed.prose;
  captured += flushed.captured;
  return { prose, captured };
}

describe("InlineThinkingFilter", () => {
  test("prose without tags passes through unchanged", () => {
    expect(feed(["Hello ", "world!"])).toEqual({
      prose: "Hello world!",
      captured: "",
    });
  });

  test("angle brackets in prose are not eaten", () => {
    expect(feed(["1 < 3 and 5 > 2"])).toEqual({
      prose: "1 < 3 and 5 > 2",
      captured: "",
    });
  });

  test("full envelope routed to captured side, prose kept", () => {
    const out = feed(["<think>plan the answer</think>", "Here it is."]);
    expect(out.captured).toBe("plan the answer");
    expect(out.prose).toBe("Here it is.");
  });

  test("envelope split across many deltas", () => {
    const out = feed(["<th", "ink>reas", "oning ", "here</thi", "nk>Answer!"]);
    expect(out.captured).toBe("reasoning here");
    expect(out.prose).toBe("Answer!");
  });

  test("prose before envelope is kept in order", () => {
    const out = feed(["First. <think>hm</think> Second."]);
    expect(out.prose).toBe("First.  Second.");
    expect(out.captured).toBe("hm");
  });

  test("multiple envelopes in one stream", () => {
    const out = feed(["<think>a</think>one<think>b</think>two"]);
    expect(out.captured).toBe("ab");
    expect(out.prose).toBe("onetwo");
  });

  test("thinking and reasoning tag variants", () => {
    expect(feed(["<thinking>x</thinking>ok"])).toEqual({
      prose: "ok",
      captured: "x",
    });
    expect(feed(["<reasoning>y</reasoning>ok"])).toEqual({
      prose: "ok",
      captured: "y",
    });
  });

  test("unclosed envelope at stream end stays captured", () => {
    const out = feed(["<think>half-way through a thought"]);
    expect(out.captured).toBe("half-way through a thought");
    expect(out.prose).toBe("");
  });

  test("partial tag that never completes flushes as prose", () => {
    const out = feed(["plain <th", "at was all"]);
    expect(out.prose).toBe("plain <that was all");
    expect(out.captured).toBe("");
  });

  test("split closing tag across deltas", () => {
    const out = feed(["<think>abc</th", "ink>done"]);
    expect(out.captured).toBe("abc");
    expect(out.prose).toBe("done");
  });

  test("empty deltas are no-ops", () => {
    const filter = new InlineThinkingFilter();
    expect(filter.push("")).toEqual({ prose: "", captured: "" });
  });

  test("custom tag sets capture other envelopes (recap)", () => {
    const recap = new InlineThinkingFilter(["recap"]);
    let prose = "";
    let captured = "";
    for (const d of ["Answer text. <rec", "ap>Fixed the wrap width so Rec", "aps stop truncating</rec", "ap>"]) {
      const out = recap.push(d);
      prose += out.prose;
      captured += out.captured;
    }
    const flushed = recap.flush();
    prose += flushed.prose;
    captured += flushed.captured;
    expect(prose).toBe("Answer text. ");
    expect(captured).toBe("Fixed the wrap width so Recaps stop truncating");
  });

  test("custom tag set ignores think envelopes", () => {
    const recap = new InlineThinkingFilter(["recap"]);
    const out = recap.push("<think>x</think><recap>y</recap>ok");
    expect(out.prose).toBe("<think>x</think>ok");
    expect(out.captured).toBe("y");
  });
});
