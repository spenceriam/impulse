import { describe, expect, test } from "bun:test";
import { QuestionOverlay } from "../src/cli/components/question-overlay.js";
import { PermissionOverlay } from "../src/cli/components/permission-overlay.js";
import { handleOverlayScrollInput } from "../src/cli/components/overlay-scroll-region.js";
import { PromptInput } from "../src/cli/prompt-input.js";
import { isShellTakeoverChord } from "../src/cli/shell-shortcuts.js";
import {
  isAbortKey,
  isBackspace,
  isCtrlC,
  isDelete,
  isDown,
  isEnter,
  isEscape,
  isLeft,
  isRight,
  isShiftBackspace,
  isShiftTab,
  isSpace,
  isTab,
  isUp,
} from "../src/cli/keys.js";
import type { PermissionRequest } from "../src/permission/types.js";

// pi-tui pushes kitty keyboard flags 1|2|4 in terminals that answer its
// `\x1b[?u` query (Foot, Alacritty, Ghostty, kitty, WezTerm, iTerm2). Under
// that protocol Esc/Ctrl+C/arrows arrive as CSI-u sequences, so these tests
// verify every helper and overlay still responds to both encodings (#155).

describe("key helpers — legacy encodings", () => {
  test("legacy bytes still match", () => {
    expect(isEscape("\x1b")).toBe(true);
    expect(isCtrlC("\x03")).toBe(true);
    expect(isAbortKey("\x1b")).toBe(true);
    expect(isAbortKey("\x03")).toBe(true);
    expect(isTab("\t")).toBe(true);
    expect(isShiftTab("\x1b[Z")).toBe(true);
    expect(isUp("\x1b[A")).toBe(true);
    expect(isDown("\x1b[B")).toBe(true);
    expect(isLeft("\x1b[D")).toBe(true);
    expect(isRight("\x1b[C")).toBe(true);
    expect(isUp("\x1bOA")).toBe(true);
    expect(isEnter("\r")).toBe(true);
    expect(isSpace(" ")).toBe(true);
    expect(isBackspace("\x7f")).toBe(true);
  });

  test("unrelated input does not match", () => {
    expect(isEscape("a")).toBe(false);
    expect(isEnter("a")).toBe(false);
    expect(isUp("a")).toBe(false);
    expect(isTab("\x1b[Z")).toBe(false);
    expect(isShiftTab("\t")).toBe(false);
  });
});

describe("key helpers — kitty CSI-u encodings", () => {
  test("escape and ctrl+c arrive as CSI u", () => {
    expect(isEscape("\x1b[27u")).toBe(true);
    expect(isCtrlC("\x1b[99;5u")).toBe(true);
    expect(isAbortKey("\x1b[27u")).toBe(true);
    expect(isAbortKey("\x1b[99;5u")).toBe(true);
  });

  test("arrows arrive as CSI u including lock-key modifier bits", () => {
    // Ghostty/Foot report caps_lock (64) and num_lock (128) on non-text keys
    expect(isUp("\x1b[1;65A")).toBe(true);
    expect(isDown("\x1b[1;129B")).toBe(true);
    expect(isLeft("\x1b[1;65D")).toBe(true);
    expect(isRight("\x1b[1;129C")).toBe(true);
  });

  test("modified arrows are not plain arrows", () => {
    expect(isUp("\x1b[1;5A")).toBe(false); // ctrl+up
    expect(isDown("\x1b[1;2B")).toBe(false); // shift+down
  });

  test("enter and tab CSI u forms", () => {
    expect(isEnter("\x1b[13u")).toBe(true);
    expect(isEnter("\x1b[13;129u")).toBe(true); // num lock on
    expect(isEnter("\x1bOM")).toBe(true); // numpad enter
    expect(isEnter("\x1b[13;5u")).toBe(false); // ctrl+enter
    expect(isEnter("\n")).toBe(false); // shift+enter custom mapping
    expect(isTab("\x1b[9u")).toBe(true);
    expect(isShiftTab("\x1b[9;2u")).toBe(true);
    expect(isTab("\x1b[9;2u")).toBe(false);
    expect(isSpace("\x1b[32u")).toBe(true);
    expect(isBackspace("\x1b[127u")).toBe(true);
  });

  test("kitty release events are ignored", () => {
    expect(isEscape("\x1b[27;1:3u")).toBe(false);
    expect(isCtrlC("\x1b[99;5:3u")).toBe(false);
    expect(isEnter("\x1b[13;1:3u")).toBe(false);
    expect(isUp("\x1b[1;1:3A")).toBe(false);
    expect(isDown("\x1b[1;129:3B")).toBe(false);
  });

  test("kitty repeat events still count as presses", () => {
    expect(isUp("\x1b[1;1:2A")).toBe(true);
    expect(isEnter("\x1b[13;1:2u")).toBe(true);
  });

  test("modifyOtherKeys encodings (tmux/SSH fallback) match", () => {
    // pi-tui enables modifyOtherKeys mode 2 when the kitty query goes
    // unanswered (tmux, some SSH setups). Mode 2 only re-encodes MODIFIED
    // keys — plain Enter stays \r — so escape/ctrl+c are the mOK forms.
    expect(isEscape("\x1b[27;1;27~")).toBe(true);
    expect(isCtrlC("\x1b[27;5;99~")).toBe(true);
    expect(isEnter("\x1b[27;1;13~")).toBe(false);
  });

  test("alt+enter stays a distinct key (line breaks survive)", () => {
    expect(isEnter("\x1b\r")).toBe(false);
    expect(isEnter("\x1b[13;3u")).toBe(false); // kitty alt+enter
  });

  test("delete helpers cover legacy and CSI-u forms", () => {
    expect(isDelete("\x1b[3~")).toBe(true);
    expect(isDelete("\x1b[3;5~")).toBe(false); // ctrl+delete is not plain delete
    expect(isDelete("\x1b[1;3:3~")).toBe(false); // release
    expect(isShiftBackspace("\x1b[127;2u")).toBe(true);
    expect(isShiftBackspace("\x7f")).toBe(false);
  });
});

function makeQuestion(topic: string) {
  return {
    topic,
    question: `Question for ${topic}?`,
    options: [
      { label: "A", description: "Option A" },
      { label: "B", description: "Option B" },
    ],
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("QuestionOverlay — kitty protocol input", () => {
  test("kitty Esc and Ctrl+C abort the overlay", () => {
    for (const key of ["\x1b[27u", "\x1b[99;5u"]) {
      const overlay = new QuestionOverlay({
        context: undefined,
        questions: [makeQuestion("T1")],
      });
      let aborted = false;
      overlay.onAbort = () => {
        aborted = true;
      };
      overlay.handleInput(key);
      expect(aborted).toBe(true);
    }
  });

  test("kitty arrow-down with num lock moves the selection pointer", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [makeQuestion("T1")],
    });
    const before = overlay.render(100).map(stripAnsi);
    overlay.handleInput("\x1b[1;129B");
    const after = overlay.render(100).map(stripAnsi);

    const rowA = after.find((line) => line.includes("Option A"))!;
    const rowB = after.find((line) => line.includes("Option B"))!;
    expect(rowA.includes("  ( )")).toBe(true);
    expect(rowB.includes("> ( )")).toBe(true);
    expect(before.find((line) => line.includes("Option A"))!.includes("> ( )")).toBe(true);
  });

  test("kitty Enter selects, advances, and submits through review", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [makeQuestion("T1"), makeQuestion("T2")],
    });
    let submitted: string[][] | undefined;
    overlay.onSubmit = (answers) => {
      submitted = answers;
    };
    overlay.onAbort = () => {
      throw new Error("abort must not fire");
    };

    overlay.handleInput("\x1b[13u"); // select A on topic 1
    overlay.handleInput("\x1b[13u"); // advance to topic 2
    overlay.handleInput("\x1b[13u"); // select A on topic 2
    overlay.handleInput("\x1b[13u"); // advance to review
    overlay.handleInput("\x1b[13u"); // submit from review

    expect(submitted).toEqual([["A"], ["A"]]);
  });

  test("legacy Tab still advances topics", () => {
    const overlay = new QuestionOverlay({
      context: undefined,
      questions: [makeQuestion("T1"), makeQuestion("T2")],
    });
    overlay.render(100);
    overlay.handleInput("\t");
    const after = overlay.render(100).map(stripAnsi);
    expect(after.some((line) => line.includes("Question for T2?"))).toBe(true);
  });
});

const bashRequest: PermissionRequest = {
  id: "1",
  sessionID: "s1",
  permission: "bash",
  patterns: ["npm test"],
  message: "Execute: npm test",
  metadata: {
    command: "npm test -- --coverage",
    reason: "Run the test suite to verify the fix",
  },
};

describe("PermissionOverlay — kitty protocol input", () => {
  test("kitty Esc and Ctrl+C reject", () => {
    for (const key of ["\x1b[27u", "\x1b[99;5u"]) {
      const overlay = new PermissionOverlay(bashRequest);
      let decision = "";
      overlay.onDecision = (response) => {
        decision = response;
      };
      overlay.handleInput(key);
      expect(decision).toBe("reject");
    }
  });

  test("kitty arrows navigate and kitty Enter confirms", () => {
    const overlay = new PermissionOverlay(bashRequest);
    let decision = "";
    overlay.onDecision = (response) => {
      decision = response;
    };

    overlay.handleInput("\x1b[1;1D"); // left: index 1 -> 0 (Deny)
    overlay.handleInput("\x1b[13u"); // confirm

    expect(decision).toBe("reject");
  });

  test("kitty right arrow keeps default selection confirmable", () => {
    const overlay = new PermissionOverlay(bashRequest);
    let decision = "";
    overlay.onDecision = (response) => {
      decision = response;
    };

    overlay.handleInput("\x1b[1;129C"); // right with num lock
    overlay.handleInput("\x1b[1;1D"); // left back to index 1
    overlay.handleInput("\x1b[13u");

    expect(decision).toBe("once");
  });
});

describe("overlay scroll region — kitty protocol input", () => {
  test("kitty arrows scroll and release events do not", () => {
    expect(handleOverlayScrollInput("\x1b[1;129B", 0, 5, 3)).toBe(1);
    expect(handleOverlayScrollInput("\x1b[1;65A", 1, 5, 3)).toBe(0);
    expect(handleOverlayScrollInput("\x1b[1;1:3B", 0, 5, 3)).toBeNull();
  });
});

describe("shell takeover chord — encodings", () => {
  test("accepts legacy, raw, and kitty CSI-u forms", () => {
    expect(isShellTakeoverChord("\x14")).toBe(true); // raw Ctrl+T
    expect(isShellTakeoverChord("\x1cT")).toBe(true); // legacy Linux form
    expect(isShellTakeoverChord("\x1b[84;6u")).toBe(true); // kitty ctrl+shift+T
    expect(isShellTakeoverChord("\x1b[116;5u")).toBe(true); // kitty ctrl+T
    expect(isShellTakeoverChord("\x1b[116;6:3u")).toBe(false); // release
    expect(isShellTakeoverChord("t")).toBe(false);
    expect(isShellTakeoverChord("T")).toBe(false);
  });
});

describe("PromptInput — kitty protocol input", () => {
  function makePrompt() {
    const prompt = new PromptInput({ text: "" });
    const events: string[] = [];
    prompt.onAbort = () => events.push("abort");
    prompt.onEscape = () => events.push("escape");
    prompt.onTabForward = () => events.push("tab");
    prompt.onTabBackward = () => events.push("shift-tab");
    prompt.onExit = () => events.push("exit");
    return { prompt, events };
  }

  test("kitty Ctrl+C aborts and kitty Esc escapes", () => {
    const { prompt, events } = makePrompt();
    prompt.handleInput("\x1b[99;5u");
    prompt.handleInput("\x1b[27u");
    expect(events).toEqual(["abort", "escape"]);
  });

  test("legacy and kitty tab forms keep cycling", () => {
    const { prompt, events } = makePrompt();
    prompt.handleInput("\t");
    prompt.handleInput("\x1b[Z");
    prompt.handleInput("\x1b[9;2u");
    expect(events).toEqual(["tab", "shift-tab", "shift-tab"]);
  });

  test("kitty release events do not trigger callbacks", () => {
    const { prompt, events } = makePrompt();
    prompt.handleInput("\x1b[99;5:3u");
    prompt.handleInput("\x1b[27;1:3u");
    expect(events).toEqual([]);
  });
});
