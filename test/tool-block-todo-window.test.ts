import { describe, expect, test } from "bun:test";
import {
  ToolBlock,
  activeTodoBlinkGlyph,
  formatTodoLine,
  selectTodoWindow,
  TODO_BLINK_PHASE_MS,
} from "../src/cli/components/tool-block.js";

function makeTodo(
  id: string,
  content: string,
  status: "pending" | "in_progress" | "completed" | "cancelled"
) {
  return { id, content, status, priority: "medium" as const };
}

describe("selectTodoWindow", () => {
  test("shows all rows when list fits within cap and nothing is done", () => {
    const todos = Array.from({ length: 16 }, (_, i) =>
      makeTodo(String(i), `Task ${i}`, i === 0 ? "in_progress" : "pending")
    );
    const window = selectTodoWindow(todos, 20);
    expect(window.headCollapseLabel).toBeUndefined();
    expect(window.visible).toHaveLength(16);
    expect(window.tailHiddenCount).toBe(0);
  });

  test("shows first 20 rows and additional-tasks footer when over cap", () => {
    const todos = Array.from({ length: 25 }, (_, i) =>
      makeTodo(String(i), `Task ${i}`, i === 0 ? "in_progress" : "pending")
    );
    const window = selectTodoWindow(todos, 20);
    expect(window.visible).toHaveLength(20);
    expect(window.tailHiddenCount).toBe(5);
  });

  test("mid-run collapses done items and keeps context + active visible", () => {
    const todos = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeTodo(`d${i}`, `Done ${i}`, "completed")
      ),
      makeTodo("ctx", "Context step", "completed"),
      makeTodo("active", "Active step", "in_progress"),
      makeTodo("p1", "Pending 1", "pending"),
      makeTodo("p2", "Pending 2", "pending"),
    ];
    const window = selectTodoWindow(todos, 20);
    expect(window.headCollapseLabel).toBe("… 10 done");
    expect(window.visible[0]?.content).toBe("Context step");
    expect(window.visible[1]?.content).toBe("Active step");
    expect(window.tailHiddenCount).toBe(0);
  });

  test("all-done state collapses to last two items", () => {
    const todos = Array.from({ length: 16 }, (_, i) =>
      makeTodo(String(i), `Task ${i}`, "completed")
    );
    const window = selectTodoWindow(todos, 20);
    expect(window.headCollapseLabel).toBe("… 14 done");
    expect(window.visible).toHaveLength(2);
    expect(window.visible[0]?.content).toBe("Task 14");
    expect(window.visible[1]?.content).toBe("Task 15");
  });

  test("uses earlier label when hidden head contains non-done items", () => {
    const todos = [
      makeTodo("1", "Out of order pending", "pending"),
      makeTodo("2", "Done", "completed"),
      makeTodo("3", "Active", "in_progress"),
    ];
    const window = selectTodoWindow(todos, 20);
    expect(window.headCollapseLabel).toBe("… 1 earlier");
    expect(window.visible.map((t) => t.content)).toEqual(["Done", "Active"]);
  });
});

describe("todo glyphs and blink", () => {
  test("formatTodoLine uses circle glyphs without color on active", () => {
    const line = formatTodoLine(makeTodo("1", "Active", "in_progress"));
    expect(line).toContain("◉ Active");
    expect(line).not.toContain("\x1b[33m");
  });

  test("completed uses dim dot and strikethrough", () => {
    const line = formatTodoLine(makeTodo("1", "Done", "completed"));
    expect(line).toContain("●");
    expect(line).toContain("\x1b[9m");
  });

  test("cancelled uses pending glyph with strikethrough", () => {
    const line = formatTodoLine(makeTodo("1", "Nope", "cancelled"));
    expect(line).toContain("○");
    expect(line).toContain("\x1b[9m");
    expect(line).not.toContain("●");
  });

  test("activeTodoBlinkGlyph alternates across phase boundary", () => {
    const t0 = 1_000_000;
    expect(activeTodoBlinkGlyph(t0, true)).toBe("◉");
    expect(activeTodoBlinkGlyph(t0 + TODO_BLINK_PHASE_MS, true)).toBe("○");
    expect(activeTodoBlinkGlyph(t0, false)).toBe("◉");
  });
});

describe("silent unchanged todo_write", () => {
  test("renders zero lines for unchanged metadata", () => {
    const block = ToolBlock.fromCompleted(
      "todo_write",
      { todos: [] },
      {
        success: true,
        output: "Todos unchanged.",
        metadata: {
          type: "todo",
          source: "write",
          unchanged: true,
          todos: [],
          total: 0,
          remaining: 0,
        },
      }
    );
    expect(block.render(120)).toEqual([]);
    expect(block.isSilentUnchangedTodo()).toBe(true);
  });

  test("real todo updates are not silent", () => {
    const block = ToolBlock.fromCompleted(
      "todo_write",
      { todos: [] },
      {
        success: true,
        output: "Todos updated.",
        metadata: {
          type: "todo",
          source: "write",
          unchanged: false,
          todos: [{ id: "1", content: "x", status: "pending", priority: "medium" }],
          total: 1,
          remaining: 1,
        },
      }
    );
    expect(block.isSilentUnchangedTodo()).toBe(false);
    expect(block.render(120).length).toBeGreaterThan(0);
  });
});
