import { describe, expect, test } from "bun:test";
import { ToolBlock } from "../src/cli/components/tool-block";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("ToolBlock", () => {
  test("formats completed durations in seconds", () => {
    const block = new ToolBlock("file_write", { path: "./temp_test/hello.txt" });
    block.setDone({ success: true, output: "ok" }, 424);

    const line = stripAnsi(block.render(120)[0] ?? "");
    expect(line).toContain("0.4s");
    expect(line).not.toContain("424ms");
  });

  test("renders completed todos with a checkmark", () => {
    const block = new ToolBlock("todo_write", { todos: [] });
    block.setDone(
      {
        success: true,
        output: "Todo list updated",
        metadata: {
          type: "todo",
          source: "write",
          total: 2,
          remaining: 1,
          todos: [
            { id: "1", content: "Done item", status: "completed", priority: "high" },
            { id: "2", content: "Active item", status: "in_progress", priority: "medium" },
          ],
        },
      },
      10,
    );

    const lines = block.render(120).map(stripAnsi).join("\n");
    expect(lines).toContain("[✓] Done item");
    expect(lines).toContain("[>] Active item");
  });

  test("keeps question rows concise while running", () => {
    const block = new ToolBlock("question", {
      context: "Validate question tool functionality",
      questions: [{ topic: "Test preferences", question: "How should I continue?" }],
    });

    const line = stripAnsi(block.render(120)[0] ?? "");
    expect(line).toContain("question");
    expect(line).toContain("Validate question tool functionality");
    expect(line).not.toContain("questions=");
  });
});
