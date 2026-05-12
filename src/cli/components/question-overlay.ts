import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";
import type { Question } from "../../tools/question.js";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};
const dimText = (s: string) => A.fg(90, s);

function padToWidth(line: string, width: number): string {
  const truncated = truncateToWidth(line, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return `${truncated}${" ".repeat(padding)}`;
}

function bgLine(line: string, width: number): string {
  const bg = "\x1b[48;5;233m";
  const padded = padToWidth(line, width).replace(/\x1b\[0m/g, `${A.reset}${bg}`);
  return `${bg}${padded}${A.reset}`;
}

function pushWrapped(lines: string[], content: string, innerWidth: number, boxWidth: number): void {
  const wrapped = wrapTextWithAnsi(content, innerWidth);
  for (const line of wrapped) {
    const padded = padToWidth(line, innerWidth);
    lines.push(bgLine(`│ ${padded} │`, boxWidth));
  }
}

export class QuestionOverlay implements Component {
  private readonly context: string | undefined;
  private readonly questions: Question[];
  private selectedTopic = 0;
  private selectedOption = 0;
  private answers: string[][];
  private customMode = false;
  private customInput = "";

  onSubmit?: (answers: string[][]) => void;
  onAbort?: () => void;

  constructor(input: { context: string | undefined; questions: Question[] }) {
    this.context = input.context;
    this.questions = input.questions;
    this.answers = input.questions.map(() => []);
  }

  invalidate(): void {}

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

    this.setSingleAnswer(option.label);
    this.advance();
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
      if (this.currentQuestion.multiple && this.selectedOption < this.currentQuestion.options.length) {
        this.chooseOption(this.selectedOption);
      }
      return;
    }

    if (data === "\r") {
      this.chooseOption(this.selectedOption);
      return;
    }

    const key = data.trim();
    if (/^[1-9]$/.test(key)) {
      const index = Number.parseInt(key, 10) - 1;
      if (index <= this.maxSelectableIndex - 1) {
        this.selectedOption = index;
        this.chooseOption(index);
      }
      return;
    }

    if (key === "0") {
      this.selectedOption = this.maxSelectableIndex;
      this.beginCustomAnswer();
    }
  }

  render(width: number): string[] {
    const boxWidth = Math.max(60, width);
    const innerWidth = Math.max(20, boxWidth - 4);
    const titleText = `${A.bold}${A.fg(39, "Need your input")}${A.reset}`;
    const topRight = "─".repeat(Math.max(0, boxWidth - 20));
    const top = bgLine(`┌─ ${titleText} ${topRight}┐`, boxWidth);
    const bottom = bgLine(`└${"─".repeat(Math.max(0, boxWidth - 2))}┘`, boxWidth);

    const lines: string[] = [top];
    const pushBoxLine = (content = "") => {
      const padded = padToWidth(content, innerWidth);
      lines.push(bgLine(`│ ${padded} │`, boxWidth));
    };

    if (this.context) {
      pushWrapped(lines, `${A.dim}Context:${A.reset} ${this.context}`, innerWidth, boxWidth);
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
    pushWrapped(lines, tabs, innerWidth, boxWidth);
    pushBoxLine("");

    pushWrapped(lines, `${A.bold}${this.currentQuestion.question}${A.reset}`, innerWidth, boxWidth);
    pushBoxLine("");

    if (this.customMode) {
      pushWrapped(lines, `${A.fg(39, "Custom answer")}`, innerWidth, boxWidth);
      pushWrapped(lines, `${A.fg(250, "> ")}${this.customInput}${A.dim}_${A.reset}`, innerWidth, boxWidth);
      pushBoxLine("");
      pushWrapped(lines, `${A.dim}Type answer   Enter submit   Esc abort${A.reset}`, innerWidth, boxWidth);
      lines.push(bottom);
      return lines;
    }

    for (let index = 0; index < this.currentQuestion.options.length; index++) {
      const option = this.currentQuestion.options[index]!;
      const pointer = index === this.selectedOption ? A.fg(39, ">") : " ";
      const selected = this.isSelected(option.label);
      const marker = selected ? A.fg(34, "[x]") : dimText("[ ]");
      const line = `${pointer} ${A.fg(250, `[${index + 1}]`)} ${marker} ${A.bold}${option.label}${A.reset} ${A.dim}— ${option.description}${A.reset}`;
      pushWrapped(lines, line, innerWidth, boxWidth);
    }

    const customPointer = this.selectedOption === this.maxSelectableIndex ? A.fg(39, ">") : " ";
    pushWrapped(
      lines,
      `${customPointer} ${A.fg(250, "[0]")} ${dimText("[ ]")} ${A.bold}Type your own answer${A.reset}`,
      innerWidth,
      boxWidth,
    );

    pushBoxLine("");
    const hints = this.currentQuestion.multiple
      ? `${A.dim}↑/↓ move   Space toggle   Tab next topic   Enter custom/select   Esc abort${A.reset}`
      : `${A.dim}↑/↓ move   Enter select   Tab next topic   Esc abort${A.reset}`;
    pushWrapped(lines, hints, innerWidth, boxWidth);
    lines.push(bottom);

    return lines;
  }
}
