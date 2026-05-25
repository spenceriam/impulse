import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";
import {
  getPermissionLabel,
  type PermissionRequest,
  type PermissionResponse,
} from "../../permission/index.js";
import { overlayBoxWidth } from "../layout.js";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number, s: string) => `\x1b[48;5;${code}m${s}\x1b[0m`,
};

const OPTIONS: Array<{ value: PermissionResponse; label: string }> = [
  { value: "reject", label: "Deny" },
  { value: "once", label: "Allow once" },
  { value: "session", label: "Allow session" },
  { value: "always", label: "Always" },
];

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

export class PermissionOverlay implements Component {
  private request: PermissionRequest;
  private selectedIndex = 1; // Default to Allow once

  onDecision?: (response: PermissionResponse) => void;

  constructor(request: PermissionRequest) {
    this.request = request;
  }

  setRequest(request: PermissionRequest): void {
    this.request = request;
    this.selectedIndex = 1;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\x03") {
      this.onDecision?.("reject");
      return;
    }

    if (data === "\x1b[D" || data === "\x1b[Z") {
      this.selectedIndex = (this.selectedIndex - 1 + OPTIONS.length) % OPTIONS.length;
      return;
    }

    if (data === "\x1b[C" || data === "\t") {
      this.selectedIndex = (this.selectedIndex + 1) % OPTIONS.length;
      return;
    }

    if (data === "\r") {
      this.onDecision?.(OPTIONS[this.selectedIndex]!.value);
      return;
    }

    const key = data.toLowerCase().trim();
    if (key === "1") this.selectedIndex = 0;
    else if (key === "2") this.selectedIndex = 1;
    else if (key === "3") this.selectedIndex = 2;
    else if (key === "4") this.selectedIndex = 3;
  }

  render(width: number): string[] {
    const boxWidth = overlayBoxWidth(width);
    const innerWidth = Math.max(8, boxWidth - 4);

    const subject = String(
      this.request.metadata?.["command"]
        ?? this.request.patterns[0]
        ?? this.request.message
    );
    const reason = typeof this.request.metadata?.["reason"] === "string"
      ? String(this.request.metadata["reason"])
      : undefined;

    const titleText = `${A.bold}${A.fg(33, "Permission required")}${A.reset}`;
    const topRight = "─".repeat(Math.max(0, boxWidth - 24));
    const top = bgLine(`┌─ ${titleText} ${topRight}┐`, boxWidth);
    const bottom = bgLine(`└${"─".repeat(Math.max(0, boxWidth - 2))}┘`, boxWidth);

    const lines: string[] = [top];
    const pushBoxLine = (content = "") => {
      const padded = padToWidth(content, innerWidth);
      lines.push(bgLine(`│ ${padded} │`, boxWidth));
    };

    pushBoxLine(`${A.bold}${getPermissionLabel(this.request.permission)}${A.reset}`);

    for (const line of wrapTextWithAnsi(subject, innerWidth)) {
      pushBoxLine(A.fg(39, line));
    }

    if (reason) {
      pushBoxLine("");
      for (const line of wrapTextWithAnsi(`${A.dim}reason:${A.reset} ${reason}`, innerWidth)) {
        pushBoxLine(line);
      }
    }

    pushBoxLine("");

    const optionLine = OPTIONS.map((option, index) => {
      const isSelected = index === this.selectedIndex;
      if (isSelected) {
        return `${A.bg(39, A.fg(16, ` ${option.label} `))}`;
      }
      return `${A.fg(250, `[ ${option.label} ]`)}`;
    }).join("   ");

    for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
      pushBoxLine(line);
    }

    pushBoxLine("");
    pushBoxLine(`${A.dim}←/→ choose   Enter confirm   Esc deny${A.reset}`);
    lines.push(bottom);

    return lines;
  }
}
