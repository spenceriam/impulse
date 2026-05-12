import { describe, expect, test } from "bun:test";
import { ToolBlock } from "../src/cli/components/tool-block";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderPlain(block: ToolBlock, width = 120): string[] {
  return block.render(width).map(stripAnsi);
}

describe("ToolBlock", () => {
  test("formats completed durations in seconds", () => {
    const block = new ToolBlock("file_write", { path: "./temp_test/hello.txt" });
    block.setDone({ success: true, output: "ok" }, 424);

    const line = stripAnsi(block.render(120)[0] ?? "");
    expect(line).toContain("0.4s");
    expect(line).not.toContain("424ms");
  });

  test("formats sub-100ms durations in milliseconds", () => {
    const block = new ToolBlock("file_edit", { filePath: "src/config.ts" });
    block.setDone({ success: true, output: "ok" }, 84);

    const line = stripAnsi(block.render(120)[0] ?? "");
    expect(line).toContain("84ms");
    expect(line).not.toContain("0.0s");
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

  test("renders compact file edit diffs", () => {
    const block = new ToolBlock("file_edit", { filePath: "src/config.ts" });
    block.setDone(
      {
        success: true,
        output: "File edited successfully",
        metadata: {
          type: "file_edit",
          filePath: "src/config.ts",
          diff: "",
          compactDiff: [" 21 const enabled = true", "-22 Value:100", "+22 Value:999|Modified:true", " 23 export default config"],
          linesAdded: 1,
          linesRemoved: 1,
          replacements: 1,
        },
      },
      84,
    );

    const rawLines = block.render(120);
    const plainLines = rawLines.map(stripAnsi);
    const output = plainLines.join("\n");
    expect(output).toContain("1 replacement, +1 -1");
    expect(plainLines).toContain("     ");
    expect(output).toContain("-22 Value:100");
    expect(output).toContain("+22 Value:999|Modified:true");
    expect(rawLines.join("\n")).toContain("\x1b[9m-22 Value:100");
  });

  test("renders compact file write previews for new files", () => {
    const block = new ToolBlock("file_write", { filePath: "src/new-module.ts" });
    block.setDone(
      {
        success: true,
        output: "File written successfully",
        metadata: {
          type: "file_write",
          filePath: "src/new-module.ts",
          linesWritten: 18,
          created: true,
          compactDiff: ["+ 1 import { run } from \"./run\";", "+ 2", "+ 3 export function main() {"],
          linesAdded: 18,
          linesRemoved: 0,
        },
      },
      72,
    );

    const plainLines = renderPlain(block);
    const output = plainLines.join("\n");
    expect(output).toContain("18 lines created");
    expect(plainLines).toContain("     ");
    expect(output).toContain("+ 1 import { run } from \"./run\";");
  });

  test("renders compact file write diffs for overwrites", () => {
    const block = new ToolBlock("file_write", { filePath: "src/settings.ts" });
    block.setDone(
      {
        success: true,
        output: "File written successfully",
        metadata: {
          type: "file_write",
          filePath: "src/settings.ts",
          linesWritten: 4,
          created: false,
          compactDiff: [" 10 export const settings = {", "-11   timeout: 1000,", "+11   timeout: 5000,", "+12   retries: 3,", " 13 };"],
          linesAdded: 2,
          linesRemoved: 1,
        },
      },
      600,
    );

    const output = block.render(120).map(stripAnsi).join("\n");
    expect(output).toContain("overwritten, +2 -1");
    expect(output).toContain("-11   timeout: 1000,");
    expect(output).toContain("+11   timeout: 5000,");
  });

  test("renders distinct glob result summaries", () => {
    const block = new ToolBlock("glob", { pattern: "**/*.ts", path: "src" });
    block.setDone(
      {
        success: true,
        output: "src/index.ts",
        metadata: {
          type: "glob",
          pattern: "**/*.ts",
          path: "src",
          matchCount: 12,
          totalMatches: 12,
          truncated: false,
        },
      },
      84,
    );

    const output = renderPlain(block).join("\n");
    expect(output).toContain("**/*.ts in src");
    expect(output).toContain("found 12 matches");
    expect(output).toContain("pattern **/*.ts");
  });

  test("renders distinct grep result summaries", () => {
    const block = new ToolBlock("grep", { pattern: "TODO", path: "src", include: "*.ts" });
    block.setDone(
      {
        success: true,
        output: "src/index.ts:1: TODO",
        metadata: {
          type: "grep",
          pattern: "TODO",
          path: "src",
          include: "*.ts",
          matchCount: 3,
          truncated: false,
        },
      },
      84,
    );

    const output = renderPlain(block).join("\n");
    expect(output).toContain("TODO in src (*.ts)");
    expect(output).toContain("found 3 matches");
    expect(output).toContain("include *.ts");
  });
});
