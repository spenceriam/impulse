import { describe, expect, test } from "bun:test";
import {
  bashRepeatNote,
  batchCompletionNote,
  countPendingToCompleted,
  todoUnchangedRepeatNote,
} from "../src/agent/repeat-notes.js";

describe("repeat notes", () => {
  test("bashRepeatNote returns nothing on first run", () => {
    expect(bashRepeatNote(1)).toBeUndefined();
  });

  test("bashRepeatNote returns full note on second identical run", () => {
    const note = bashRepeatNote(2);
    expect(note).toContain("identical command already run this turn");
    expect(note).toContain("Avoid re-verifying");
  });

  test("bashRepeatNote returns short counter on third+ run", () => {
    expect(bashRepeatNote(3)).toBe("\nNote: command run 3 times this turn.");
    expect(bashRepeatNote(5)).toBe("\nNote: command run 5 times this turn.");
  });

  test("todoUnchangedRepeatNote returns nothing on first unchanged", () => {
    expect(todoUnchangedRepeatNote(1)).toBeUndefined();
  });

  test("todoUnchangedRepeatNote returns note on second+ consecutive unchanged", () => {
    const note = todoUnchangedRepeatNote(2);
    expect(note).toContain("todo_write already returned unchanged");
    expect(todoUnchangedRepeatNote(3)).toBe(note);
  });

  test("countPendingToCompleted matches by content and ignores in_progress transitions", () => {
    const current = [
      { content: "A", status: "pending" },
      { content: "B", status: "in_progress" },
      { content: "C", status: "pending" },
    ];
    const incoming = [
      { content: "A", status: "completed" },
      { content: "B", status: "completed" },
      { content: "C", status: "completed" },
    ];
    expect(countPendingToCompleted(current, incoming)).toBe(2);
  });

  test("batchCompletionNote returns nothing below threshold", () => {
    expect(batchCompletionNote(2)).toBeUndefined();
  });

  test("batchCompletionNote returns corrective note at 3+", () => {
    const note = batchCompletionNote(4);
    expect(note).toContain("4 items jumped pending -> completed");
    expect(note).toContain("mark in_progress when starting");
  });
});
