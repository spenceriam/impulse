import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Bus, TodoEvents } from "../src/bus/index.js";
import { SessionManager } from "../src/session/manager.js";
import { SessionStoreInstance } from "../src/session/store.js";
import { Todo, type Todo as TodoItem } from "../src/session/todo.js";
import { Storage } from "../src/storage/index.js";

const baselineTodos: TodoItem[] = [
  {
    id: "baseline",
    content: "Replacement generation",
    status: "in_progress",
    priority: "high",
  },
];

const staleTodos: TodoItem[] = [
  {
    id: "stale",
    content: "Old generation",
    status: "completed",
    priority: "low",
  },
];

describe("todo session generations", () => {
  let project: string;
  let originalCwd: string;
  let sessionID: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    project = fs.mkdtempSync(path.join(os.tmpdir(), "impulse-todo-generation-"));
    process.chdir(project);
    SessionManager.setOptions({
      defaultMode: "ASK",
      defaultModel: "test/model",
      initialContextWindow: 100_000,
    });
    const session = await SessionManager.createNew("todo-generation");
    sessionID = session.id;
    await Todo.update(baselineTodos);
  });

  afterEach(async () => {
    await SessionManager.exitCurrent();
    await Storage.remove(["todo", sessionID]).catch(() => {});
    await SessionStoreInstance.delete(sessionID).catch(() => {});
    process.chdir(originalCwd);
    fs.rmSync(project, { recursive: true, force: true });
  });

  test("a delayed old todo mutation has no effects after same-ID resume", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const write = Storage.write.bind(Storage);
    const writeSpy = spyOn(Storage, "write").mockImplementation(async (...args) => {
      const [key, value] = args;
      if (key[0] === "todo" && value === staleTodos) {
        started();
        await gate;
      }
      return write(...args);
    });
    const todoEvents: TodoItem[][] = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type !== TodoEvents.Updated.name) return;
      const properties = event.properties as { sessionID: string; todos: TodoItem[] };
      if (properties.sessionID === sessionID) todoEvents.push(properties.todos);
    });
    try {
      const staleUpdate = Todo.update(staleTodos);
      await didStart;

      const resumedPromise = SessionManager.load(sessionID);
      let resumeSettled = false;
      void resumedPromise.finally(() => { resumeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resumeSettled).toBe(false);
      release();
      const resumed = await resumedPromise;
      await staleUpdate;

      expect(resumed.todos).toEqual(baselineTodos);
      expect(SessionManager.getCurrentSession()?.todos).toEqual(baselineTodos);
      expect((await SessionStoreInstance.read(sessionID)).todos).toEqual(baselineTodos);
      expect(await Todo.get()).toEqual(baselineTodos);
      expect(todoEvents).toEqual([]);
    } finally {
      release();
      unsubscribe();
      writeSpy.mockRestore();
    }
  });

  test("same-generation todo mutations serialize in call order", async () => {
    const firstTodos: TodoItem[] = [
      { id: "first", content: "First", status: "pending", priority: "medium" },
    ];
    const secondTodos: TodoItem[] = [
      { id: "second", content: "Second", status: "completed", priority: "high" },
    ];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const write = Storage.write.bind(Storage);
    let todoWriteCalls = 0;
    const writeSpy = spyOn(Storage, "write").mockImplementation(async (...args) => {
      const [key, value] = args;
      if (key[0] === "todo") {
        todoWriteCalls++;
        if (value === firstTodos) {
          started();
          await gate;
        }
      }
      return write(...args);
    });

    try {
      const first = Todo.update(firstTodos);
      await didStart;
      const second = Todo.update(secondTodos);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(todoWriteCalls).toBe(1);

      release();
      await Promise.all([first, second]);

      expect(await Todo.get()).toEqual(secondTodos);
      expect(SessionManager.getCurrentSession()?.todos).toEqual(secondTodos);
      expect((await SessionStoreInstance.read(sessionID)).todos).toEqual(secondTodos);
    } finally {
      release();
      writeSpy.mockRestore();
    }
  });

  test("same-ID resume wins when an old todo promotion was already admitted", async () => {
    const originalGeneration = SessionManager.captureCurrentSessionMutation()!.generation;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const write = Storage.write.bind(Storage);
    const writeSpy = spyOn(Storage, "write").mockImplementation(async (...args) => {
      const [key, value, guard] = args;
      if (key[0] !== "todo" || value !== staleTodos) return write(...args);

      const admitted = guard?.canCommit() ?? true;
      started();
      await gate;
      // Model a promotion whose synchronous predicate passed immediately
      // before the replacement generation installed its fence.
      return admitted ? write(key, value) : write(...args);
    });
    const staleEvents: TodoItem[][] = [];
    const unsubscribe = Bus.subscribe((event) => {
      if (event.type !== TodoEvents.Updated.name) return;
      const properties = event.properties as { sessionID: string; todos: TodoItem[] };
      if (properties.sessionID === sessionID) staleEvents.push(properties.todos);
    });

    try {
      const staleUpdate = Todo.update(staleTodos);
      await didStart;
      const resumedPromise = SessionManager.load(sessionID);
      let resumeSettled = false;
      void resumedPromise.finally(() => { resumeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resumeSettled).toBe(false);
      expect(SessionManager.captureCurrentSessionMutation()!.generation).toBe(
        originalGeneration
      );

      release();
      const [resumed] = await Promise.all([resumedPromise, staleUpdate]);

      expect(resumed.todos).toEqual(baselineTodos);
      expect(SessionManager.getCurrentSession()?.todos).toEqual(baselineTodos);
      expect((await SessionStoreInstance.read(sessionID)).todos).toEqual(baselineTodos);
      expect(await Todo.get()).toEqual(baselineTodos);
      expect(staleEvents).toEqual([]);
    } finally {
      release();
      unsubscribe();
      writeSpy.mockRestore();
    }
  });

  test("a failed todo mutation does not poison the same-generation queue", async () => {
    const recoveredTodos: TodoItem[] = [
      { id: "recovered", content: "Recovered", status: "pending", priority: "low" },
    ];
    const write = Storage.write.bind(Storage);
    let todoWriteCalls = 0;
    const writeSpy = spyOn(Storage, "write").mockImplementation(async (...args) => {
      if (args[0][0] === "todo" && ++todoWriteCalls === 1) {
        throw new Error("injected todo persistence failure");
      }
      return write(...args);
    });

    try {
      const failed = Todo.update(staleTodos);
      const recovered = Todo.update(recoveredTodos);
      await expect(failed).rejects.toThrow("injected todo persistence failure");
      await expect(recovered).resolves.toBeUndefined();

      expect(await Todo.get()).toEqual(recoveredTodos);
      expect(SessionManager.getCurrentSession()?.todos).toEqual(recoveredTodos);
      expect((await SessionStoreInstance.read(sessionID)).todos).toEqual(recoveredTodos);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
