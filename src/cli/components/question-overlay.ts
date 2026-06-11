import { type Component, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { Question } from "../../tools/question.js";
import { overlayBoxWidth } from "../layout.js";
import {
  handleOverlayScrollInput,
  overlayScrollPageStep,
  OVERLAY_SCROLL_FOOTER,
  sliceOverlayBody,
} from "./overlay-scroll-region.js";
import {
  capOverlayText,
  intrinsicFramedBoxWidth,
  overlayBottomBorder,
  overlayDim,
  overlayPushWrapped,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};
const dimText = (s: string) => A.fg(90, s);

export class QuestionOverlay implements Component {
  private readonly context: string | undefined;
  private readonly questions: Question[];
  private selectedTopic = 0;
  private selectedOption = 0;
  private answers: string[][];
  private customMode = false;
  private customInput = "";
  private reviewMode = false;
  private maxHeight = 0;
  private scrollTop = 0;
  private measureTerminalWidth: number | null = null;
  private lastBodyLineCount = 0;
  /** Index in buildAllLines output where footer + bottom border begin. */
  private chromeBottomStart = 0;
  private allLinesLength = 0;

  onSubmit?: (answers: string[][]) => void;
  onAbort?: () => void;

  constructor(input: { context: string | undefined; questions: Question[] }) {
    this.context = input.context;
    this.questions = input.questions;
    this.answers = input.questions.map(() => []);
  }

  invalidate(): void {}

  setMaxHeight(lines: number): void {
    this.maxHeight = Math.max(0, lines);
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const cap = overlayBoxWidth(terminal);
    const lines = this.buildAllLines(cap);
    const widths = lines.map((line) => visibleWidth(line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")));
    return Math.min(cap, intrinsicFramedBoxWidth(terminal, "Need your input", widths));
  }

  private viewportBodyLines(chromeBottomStart?: number, allLinesLength?: number): number {
    const bottomStart = chromeBottomStart ?? this.chromeBottomStart;
    const totalLength = allLinesLength ?? this.allLinesLength;
    const chromeLines = 1 + Math.max(1, totalLength - bottomStart);
    if (this.maxHeight <= chromeLines) return 1;
    return Math.max(1, this.maxHeight - chromeLines);
  }

  private get currentQuestion(): Question {
    return this.questions[this.selectedTopic]!;
  }

  private get maxSelectableIndex(): number {
    return this.currentQuestion.options.length; // last row = custom answer
  }

  private isSelected(label: string): boolean {
    return (this.answers[this.selectedTopic] ?? []).includes(label);
  }

  private setSingleAnswer(value: string): void {
    this.answers[this.selectedTopic] = [value];
  }

  private toggleMultiAnswer(value: string): void {
    const current = new Set(this.answers[this.selectedTopic] ?? []);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    this.answers[this.selectedTopic] = Array.from(current);
  }

  private advance(): void {
    if (this.selectedTopic < this.questions.length - 1) {
      this.selectedTopic += 1;
      this.selectedOption = 0;
      this.customMode = false;
      this.customInput = "";
      return;
    }

    this.customMode = false;
    this.customInput = "";
    this.scrollTop = 0;
    this.reviewMode = true;
  }

  private submit(): void {
    this.customMode = false;
    this.customInput = "";
    this.onSubmit?.(this.answers.map((answer) => [...answer]));
  }

  private previousTopic(): void {
    if (this.selectedTopic === 0) return;
    this.selectedTopic -= 1;
    this.selectedOption = 0;
    this.customMode = false;
    this.customInput = "";
  }

  private nextTopic(): void {
    if (this.selectedTopic >= this.questions.length - 1) return;
    this.selectedTopic += 1;
    this.selectedOption = 0;
    this.customMode = false;
    this.customInput = "";
  }

  private beginCustomAnswer(): void {
    this.customMode = true;
    this.customInput = (this.answers[this.selectedTopic] ?? [])[0] ?? "";
  }

  private chooseOption(index: number): void {
    if (index >= this.currentQuestion.options.length) {
      this.beginCustomAnswer();
      return;
    }

    const option = this.currentQuestion.options[index];
    if (!option) return;

    if (this.currentQuestion.multiple) {
      this.toggleMultiAnswer(option.label);
      return;
    }

    // Single-choice: if already selected, advance; otherwise just select
    if (this.isSelected(option.label)) {
      this.advance();
      return;
    }
    this.setSingleAnswer(option.label);
  }

  private optionMarker(selected: boolean): string {
    if (this.currentQuestion.multiple) {
      return selected ? A.fg(34, "[x]") : dimText("[ ]");
    }

    return selected ? A.fg(34, "(•)") : dimText("( )");
  }

  handleInput(data: string): void {
    if (data.length > 1 && !data.includes("\x1b") && (data.includes("\r") || data.includes("\n"))) {
      for (const char of data) this.handleInput(char);
      return;
    }

    if (data === "\x03" || data === "\x1b") {
      this.onAbort?.();
      return;
    }

    if (this.reviewMode) {
      if (data === "\r") {
        this.submit();
        return;
      }
      if (data === "e" || data === "E") {
        this.reviewMode = false;
        this.selectedTopic = 0;
        this.selectedOption = 0;
        this.scrollTop = 0;
        return;
      }
      const maxTop = Math.max(0, this.lastBodyLineCount - this.viewportBodyLines());
      const scrollNext = handleOverlayScrollInput(
        data,
        this.scrollTop,
        maxTop,
        overlayScrollPageStep(this.viewportBodyLines())
      );
      if (scrollNext !== null) {
        this.scrollTop = scrollNext;
        return;
      }
      return;
    }

    if (this.customMode) {
      if (data === "\r") {
        const value = this.customInput.trim();
        if (value.length === 0) return;
        this.setSingleAnswer(value);
        this.customMode = false;
        this.customInput = "";
        this.advance();
        return;
      }

      if (data === "\x7f" || data === "\b") {
        this.customInput = this.customInput.slice(0, -1);
        return;
      }

      if (data >= " " && !data.startsWith("\x1b")) {
        this.customInput += data;
      }
      return;
    }

    if (data === "\x1b[A") {
      this.selectedOption = (this.selectedOption - 1 + this.maxSelectableIndex + 1) % (this.maxSelectableIndex + 1);
      return;
    }

    if (data === "\x1b[B") {
      this.selectedOption = (this.selectedOption + 1) % (this.maxSelectableIndex + 1);
      return;
    }

    if (data === "\t" || data === "\x1b[C") {
      this.nextTopic();
      return;
    }

    if (data === "\x1b[Z" || data === "\x1b[D") {
      this.previousTopic();
      return;
    }

    if (data === " ") {
      if (this.selectedOption >= this.currentQuestion.options.length) {
        this.beginCustomAnswer();
        return;
      }

      if (this.currentQuestion.multiple) {
        this.chooseOption(this.selectedOption);
        return;
      }

      const option = this.currentQuestion.options[this.selectedOption];
      if (option) this.setSingleAnswer(option.label);
      return;
    }

    if (data === "\r") {
      this.chooseOption(this.selectedOption);
      return;
    }

  }

  private buildAllLines(boxWidth: number): string[] {
    const innerWidth = Math.max(20, boxWidth - 4);

    const lines: string[] = [];
    lines.push(overlayTitleLine("Need your input", boxWidth));

    const pushBoxLine = (content = "") => {
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    if (this.reviewMode) {
      const reviewBodyStart = lines.length;
      overlayPushWrapped(
        lines,
        `${A.bold}${A.fg(39, "Review your answers")}${A.reset}`,
        innerWidth,
        boxWidth
      );
      pushBoxLine("");
      for (let i = 0; i < this.questions.length; i++) {
        const q = this.questions[i]!;
        const answer = (this.answers[i] ?? []).join(", ") || A.dim + "(no answer)" + A.reset;
        overlayPushWrapped(
          lines,
          `${A.fg(39, "[" + (i + 1) + "]")} ${capOverlayText(q.question, 120)}`,
          innerWidth,
          boxWidth
        );
        overlayPushWrapped(
          lines,
          `  ${A.bold}→${A.reset} ${answer}`,
          innerWidth,
          boxWidth
        );
        pushBoxLine("");
      }
      const reviewBodyLines = lines.length - reviewBodyStart;
      this.chromeBottomStart = lines.length;
      const scrollFooter = `Enter submit  e edit  ${OVERLAY_SCROLL_FOOTER}`;
      const projectedChromeBottom =
        wrapTextWithAnsi(overlayDim(scrollFooter), innerWidth).length + 1;
      const reviewFooter =
        reviewBodyLines >
        this.viewportBodyLines(this.chromeBottomStart, lines.length + projectedChromeBottom)
          ? scrollFooter
          : "Enter submit  e edit  Esc go back";
      overlayPushWrapped(lines, overlayDim(reviewFooter), innerWidth, boxWidth);
      lines.push(overlayBottomBorder(boxWidth));
      return lines;
    }

    if (this.context) {
      overlayPushWrapped(
        lines,
        `${A.dim}Context:${A.reset} ${capOverlayText(this.context, 120)}`,
        innerWidth,
        boxWidth
      );
      pushBoxLine("");
    }

    const tabs = this.questions
      .map((question, index) => {
        const answered = (this.answers[index] ?? []).length > 0 ? ` ${A.fg(34, "✓")}` : "";
        const label = `${question.topic}${answered}`;
        if (index === this.selectedTopic) {
          return `${A.bg(39, A.fg(16, ` ${label} `))}`;
        }
        return `${A.fg(250, `[ ${label} ]`)}`;
      })
      .join(" ");
    overlayPushWrapped(lines, tabs, innerWidth, boxWidth);
    pushBoxLine("");

    overlayPushWrapped(
      lines,
      `${A.bold}${capOverlayText(this.currentQuestion.question, 120)}${A.reset}`,
      innerWidth,
      boxWidth
    );
    pushBoxLine("");

    if (this.customMode) {
      overlayPushWrapped(lines, `${A.fg(39, "Custom answer")}`, innerWidth, boxWidth);
      overlayPushWrapped(
        lines,
        `${A.fg(250, "> ")}${this.customInput}${A.dim}_${A.reset}`,
        innerWidth,
        boxWidth
      );
      pushBoxLine("");
      this.chromeBottomStart = lines.length;
      overlayPushWrapped(
        lines,
        `${A.dim}Type answer   Enter submit   Esc abort${A.reset}`,
        innerWidth,
        boxWidth
      );
      lines.push(overlayBottomBorder(boxWidth));
      return lines;
    }

    for (let index = 0; index < this.currentQuestion.options.length; index++) {
      const option = this.currentQuestion.options[index]!;
      const pointer = index === this.selectedOption ? A.fg(39, ">") : " ";
      const selected = this.isSelected(option.label);
      const marker = this.optionMarker(selected);
      const descSuffix =
        option.description !== undefined && option.description.length > 0
          ? ` ${A.dim}— ${option.description}${A.reset}`
          : "";
      const line = `${pointer} ${marker} ${A.bold}${option.label}${A.reset}${descSuffix}`;
      overlayPushWrapped(lines, line, innerWidth, boxWidth);
    }

    const customPointer = this.selectedOption === this.maxSelectableIndex ? A.fg(39, ">") : " ";
    overlayPushWrapped(
      lines,
      `${customPointer} ${dimText("( )")} ${A.bold}Type your own answer${A.reset}`,
      innerWidth,
      boxWidth
    );

    pushBoxLine("");
    const hints = this.currentQuestion.multiple
      ? `${A.dim}↑/↓ move   Space toggle   Enter confirm/custom   Tab next topic   Esc abort${A.reset}`
      : `${A.dim}↑/↓ move   Enter select/advance   Space select   Tab next topic   Esc abort${A.reset}`;
    this.chromeBottomStart = lines.length;
    overlayPushWrapped(lines, hints, innerWidth, boxWidth);
    lines.push(overlayBottomBorder(boxWidth));

    return lines;
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const allLines = this.buildAllLines(boxWidth);
    this.allLinesLength = allLines.length;
    const chromeBottomCount = allLines.length - this.chromeBottomStart;
    if (this.maxHeight <= 0 || allLines.length <= this.maxHeight) {
      this.scrollTop = 0;
      this.lastBodyLineCount = Math.max(0, allLines.length - 1 - chromeBottomCount);
      return allLines;
    }

    const chromeTop = [allLines[0]!];
    const chromeBottom = allLines.slice(this.chromeBottomStart);
    const body = allLines.slice(1, this.chromeBottomStart);
    this.lastBodyLineCount = body.length;

    const slice = sliceOverlayBody(body, this.viewportBodyLines(), this.scrollTop);
    this.scrollTop = Math.min(this.scrollTop, slice.maxScrollTop);

    return [...chromeTop, ...slice.visibleLines, ...chromeBottom];
  }
}
