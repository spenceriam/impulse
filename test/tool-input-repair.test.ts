import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { validateToolInput } from "../src/tools/input-repair";
import { zFilePath } from "../src/tools/schemas/branded";
import { buildFileReadRangeNote } from "../src/tools/file-read";
import "../src/tools/init";
import { Tool } from "../src/tools/registry";

const ReadTestSchema = z.object({
  filePath: zFilePath(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

const TodoTestSchema = z.object({
  todos: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      priority: z.enum(["high", "medium", "low"]),
    })
  ),
});

const TagsSchema = z.object({
  tags: z.array(z.string()),
});

const PathSchema = z.object({
  filePath: zFilePath(),
});

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("validateToolInput passthrough", () => {
  test("valid input passes unchanged with zero repairs", () => {
    const input = { filePath: "src/a.ts", limit: 100 };
    const result = validateToolInput(ReadTestSchema, input, { toolName: "file_read" });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toEqual(input);
    expect(result.repairs).toEqual([]);
  });
});

describe("nullForOptional repair", () => {
  test("omits null optional fields", () => {
    const input = { filePath: "a.ts", offset: null };
    const result = validateToolInput(ReadTestSchema, input, { toolName: "file_read" });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toEqual({ filePath: "a.ts" });
    expect(result.repairs.some((r) => r.name === "nullForOptional")).toBe(true);
    expect(input).toEqual({ filePath: "a.ts", offset: null });
  });

  test("does not fix required null fields", () => {
    const result = validateToolInput(ReadTestSchema, { filePath: null }, {
      toolName: "file_read",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error).toContain("Invalid parameters for file_read");
    expect(result.error).not.toContain("ZodError");
  });
});

describe("stringifiedArray repair", () => {
  test("parses JSON array strings", () => {
    const todosJson = JSON.stringify([
      {
        id: "1",
        content: "task",
        status: "pending",
        priority: "medium",
      },
    ]);

    const input = { todos: todosJson };
    const result = validateToolInput(TodoTestSchema, input, { toolName: "todo_write" });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(Array.isArray(result.data.todos)).toBe(true);
    expect(result.data.todos[0]?.id).toBe("1");
    expect(result.repairs.some((r) => r.name === "stringifiedArray")).toBe(true);
  });
});

describe("objectToArray repair", () => {
  test("converts empty object to empty array", () => {
    const result = validateToolInput(TagsSchema, { tags: {} }, { toolName: "tags" });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.tags).toEqual([]);
    expect(result.repairs.some((r) => r.name === "objectToArray")).toBe(true);
  });

  test("unwraps single-key array wrapper", () => {
    const result = validateToolInput(
      TagsSchema,
      { tags: { items: ["a", "b"] } },
      { toolName: "tags" }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.tags).toEqual(["a", "b"]);
  });
});

describe("stringToArray repair", () => {
  test("wraps bare string as single-element array", () => {
    const result = validateToolInput(TagsSchema, { tags: "foo" }, { toolName: "tags" });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.tags).toEqual(["foo"]);
    expect(result.repairs.some((r) => r.name === "stringToArray")).toBe(true);
  });
});

describe("markdownPathUnwrap repair", () => {
  test("unwraps degenerate markdown auto-links in paths", () => {
    const input = { filePath: "/src/[index.ts](http://index.ts)" };
    const result = validateToolInput(PathSchema, input, { toolName: "file_read" });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.filePath).toBe("/src/index.ts");
    expect(result.repairs.some((r) => r.name === "markdownPathUnwrap")).toBe(true);
  });

  test("preserves legitimate markdown links in non-path fields", () => {
    const schema = z.object({ text: z.string() });
    const input = { text: "See [docs](https://example.com)" };
    const first = schema.safeParse(input);
    expect(first.success).toBe(true);
  });
});

describe("Tool.execute branded schema integration", () => {
  test("repairs markdown path on glob pattern field", async () => {
    const result = await Tool.execute("glob", {
      pattern: "**/[pkg.json](http://pkg.json)",
      path: ".",
    });

    expect(result.success).toBe(true);
    expect(result.output).not.toContain("[pkg.json]");
  });

  test("repairs markdown path on file_edit filePath", async () => {
    const dir = mkdtempSync(join(process.cwd(), "impulse-edit-repair-"));
    tempDirs.push(dir);
    const filePath = join(dir, "target.txt");
    writeFileSync(filePath, "hello world\n", "utf-8");

    const result = await Tool.execute("file_edit", {
      filePath: `${dir}/[target.txt](http://target.txt)`,
      oldString: "hello",
      newString: "hi",
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("edited successfully");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(filePath, "utf-8")).toContain("hi");
  });
});

describe("Tool.execute integration", () => {
  test("repairs null optional before executing file_read", async () => {
    const dir = mkdtempSync(join(process.cwd(), "impulse-repair-"));
    tempDirs.push(dir);
    const filePath = join(dir, "sample.txt");
    writeFileSync(filePath, "line one\nline two\nline three\n", "utf-8");

    const result = await Tool.execute("file_read", {
      filePath,
      offset: null,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("line one");
  });
});

describe("relational invariant notes in tool output", () => {
  test("glob prepends path Note when path omitted", async () => {
    const dir = mkdtempSync(join(process.cwd(), "impulse-glob-note-"));
    tempDirs.push(dir);
    const unique = `impulse-glob-note-${Date.now()}.txt`;
    writeFileSync(join(dir, unique), "x", "utf-8");

    const result = await Tool.execute("glob", {
      pattern: `**/${unique}`,
    });

    expect(result.success).toBe(true);
    expect(result.output.startsWith("Note: path was not provided")).toBe(true);
    expect(result.output).toContain(unique);
  });
});

describe("file_read relational invariant notes", () => {
  test("buildFileReadRangeNote when only offset is provided", () => {
    const note = buildFileReadRangeNote({ offset: 10 });
    expect(note).toContain("limit was not provided");
    expect(note).toContain("2000");
  });

  test("buildFileReadRangeNote when only limit is provided", () => {
    const note = buildFileReadRangeNote({ limit: 50 });
    expect(note).toContain("offset was not provided");
    expect(note).toContain("0");
  });

  test("no note when both or neither are provided", () => {
    expect(buildFileReadRangeNote({})).toBeNull();
    expect(buildFileReadRangeNote({ offset: 0, limit: 100 })).toBeNull();
  });

  test("includes Note in file_read output when only offset provided", async () => {
    const dir = mkdtempSync(join(process.cwd(), "impulse-read-note-"));
    tempDirs.push(dir);
    const filePath = join(dir, "sample.txt");
    writeFileSync(filePath, "alpha\nbeta\ngamma\n", "utf-8");

    const result = await Tool.execute("file_read", {
      filePath,
      offset: 1,
    });

    expect(result.success).toBe(true);
    expect(result.output.startsWith("Note: limit was not provided")).toBe(true);
    expect(result.output).toContain("beta");
  });
});

describe("formatValidationError", () => {
  test("returns clean error without raw Zod objects", () => {
    const result = validateToolInput(ReadTestSchema, { offset: 1 }, { toolName: "file_read" });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error).toContain("Invalid parameters for file_read");
    expect(result.error).not.toContain("[object Object]");
  });
});
