import { describe, expect, test, beforeEach } from "bun:test";
import { PromptHistory } from "../src/cli/prompt-history.js";

describe("PromptHistory", () => {
  let history: PromptHistory;

  beforeEach(() => {
    history = new PromptHistory();
  });

  test("Up recalls newest then older entries", () => {
    history.push("hello");
    history.push("world");
    expect(history.previous()).toBe("world");
    expect(history.previous()).toBe("hello");
    expect(history.previous()).toBe("hello");
  });

  test("Down reset clears browsing index", () => {
    history.push("a");
    history.push("b");
    history.previous();
    history.resetIndex();
    expect(history.previous()).toBe("b");
  });

  test("skips empty and consecutive duplicates", () => {
    history.push("");
    history.push("same");
    history.push("same");
    expect(history.size()).toBe(1);
  });

  test("reset clears all entries", () => {
    history.push("x");
    history.reset();
    expect(history.size()).toBe(0);
    expect(history.previous()).toBeNull();
  });
});
