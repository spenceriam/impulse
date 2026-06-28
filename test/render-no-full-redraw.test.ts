import { describe, expect, test } from "bun:test";
import { Container, Text, TUI, type Terminal } from "@mariozechner/pi-tui";
import { ToolBlock } from "../src/cli/components/tool-block.js";

class FakeTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  writes: string[] = [];

  start(): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}

  get fullClearCount(): number {
    return this.writes.filter((write) => write.includes("\x1b[2J\x1b[H\x1b[3J")).length;
  }
}

async function waitForRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("top-anchored rendering", () => {
  test("settling a file edit diff keeps the diff and avoids full clears", async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    tui.setClearOnShrink(false);

    const root = new Container();
    for (let i = 0; i < 80; i++) {
      root.addChild(new Text(`history ${i}`, 0, 0));
    }

    const block = new ToolBlock("file_edit", {
      filePath: "src/example.ts",
      oldString: "before",
      newString: "after",
    });
    root.addChild(block);
    tui.addChild(root);

    tui.start();
    await waitForRender();

    const redrawsBeforeSettle = tui.fullRedraws;
    const clearsBeforeSettle = terminal.fullClearCount;
    block.setDone(
      {
        success: true,
        output: "Edited src/example.ts",
        metadata: {
          type: "file_edit",
          filePath: "src/example.ts",
          diff: "- before\n+ after",
          compactDiff: ["-1 before", "+1 after"],
          linesAdded: 1,
          linesRemoved: 1,
        },
      },
      12,
      { collapsed: false, compact: false }
    );
    tui.requestRender();
    await waitForRender();

    expect(tui.fullRedraws).toBe(redrawsBeforeSettle);
    expect(terminal.fullClearCount).toBe(clearsBeforeSettle);
    const rendered = block.render(80).join("\n");
    expect(rendered).toContain("before");
    expect(rendered).toContain("after");
  });
});
