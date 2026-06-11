import { describe, expect, test, beforeEach } from "bun:test";
import { SessionManager } from "../src/session/manager.js";
import { Todo } from "../src/session/todo.js";
import { Tool } from "../src/tools/registry.js";
import "../src/tools/init.js";

describe("todo_write no-op dedup", () => {
  beforeEach(async () => {
    await SessionManager.createNew("todo-noop-test");
    await Todo.update([
      {
        id: "1",
        content: "Task one",
        status: "in_progress",
        priority: "high",
      },
      {
        id: "2",
        content: "Task two",
        status: "pending",
        priority: "medium",
      },
    ]);
  });

  test("returns unchanged metadata when list is identical by content+status", async () => {
    const result = await Tool.execute("todo_write", {
      todos: [
        {
          id: "new-id-1",
          content: "Task one",
          status: "in_progress",
          priority: "low",
        },
        {
          id: "new-id-2",
          content: "Task two",
          status: "pending",
          priority: "high",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("Todos unchanged.");
    expect(result.metadata?.["unchanged"]).toBe(true);
  });

  test("updates when status changes", async () => {
    const result = await Tool.execute("todo_write", {
      todos: [
        {
          id: "1",
          content: "Task one",
          status: "completed",
          priority: "high",
        },
        {
          id: "2",
          content: "Task two",
          status: "pending",
          priority: "medium",
        },
      ],
    });

    expect(result.output).toContain("Todo list updated");
    expect(result.metadata?.["unchanged"]).toBeUndefined();
  });

  test("appends batch note when 4 items jump pending to completed", async () => {
    await Todo.update([
      { id: "1", content: "One", status: "pending", priority: "high" },
      { id: "2", content: "Two", status: "pending", priority: "high" },
      { id: "3", content: "Three", status: "pending", priority: "high" },
      { id: "4", content: "Four", status: "pending", priority: "high" },
    ]);

    const result = await Tool.execute("todo_write", {
      todos: [
        { id: "1", content: "One", status: "completed", priority: "high" },
        { id: "2", content: "Two", status: "completed", priority: "high" },
        { id: "3", content: "Three", status: "completed", priority: "high" },
        { id: "4", content: "Four", status: "completed", priority: "high" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("4 items jumped pending -> completed");
  });

  test("does not append batch note for in_progress plus one pending completion", async () => {
    await Todo.update([
      { id: "1", content: "Active", status: "in_progress", priority: "high" },
      { id: "2", content: "Next", status: "pending", priority: "medium" },
    ]);

    const result = await Tool.execute("todo_write", {
      todos: [
        { id: "1", content: "Active", status: "completed", priority: "high" },
        { id: "2", content: "Next", status: "completed", priority: "medium" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.output).not.toContain("jumped pending -> completed");
  });
});
