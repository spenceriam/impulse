import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import {
  type PermissionRequest,
  type PermissionResponse,
} from "../../permission/index.js";
import {
  formatPermissionAction,
  formatPermissionReason,
  formatPermissionWhyPolicy,
} from "../permission-display.js";
import { overlayBoxWidth } from "../layout.js";
import {
  intrinsicFramedBoxWidth,
  measureOverlayTopChromeWidth,
  overlayBottomBorder,
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

const OPTIONS: Array<{ value: PermissionResponse; label: string }> = [
  { value: "reject", label: "Deny" },
  { value: "once", label: "Allow once" },
  { value: "session", label: "Allow session" },
  { value: "always", label: "Always" },
];

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export class PermissionOverlay implements Component {
  private request: PermissionRequest;
  private selectedIndex = 1;
  private measureTerminalWidth: number | null = null;

  onDecision?: (response: PermissionResponse) => void;

  constructor(request: PermissionRequest) {
    this.request = request;
  }

  setRequest(request: PermissionRequest): void {
    this.request = request;
    this.selectedIndex = 1;
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const cap = overlayBoxWidth(terminal);
    const innerWidth = Math.max(8, cap - 4);
    const plainWidths: number[] = [measureOverlayTopChromeWidth("Permission required", 33)];

    plainWidths.push(visibleWidth(formatPermissionAction(this.request)));
    plainWidths.push(visibleWidth(formatPermissionReason(this.request)));

    const { why } = formatPermissionWhyPolicy(this.request);
    if (why) {
      plainWidths.push(visibleWidth(`Why: ${why}`));
    }

    const optionLine = OPTIONS.map((o) => `[ ${o.label} ]`).join("   ");
    for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
      plainWidths.push(visibleWidth(line));
    }
    plainWidths.push(visibleWidth("←/→ choose   Enter confirm   Esc deny"));

    return Math.min(cap, intrinsicFramedBoxWidth(terminal, "Permission required", plainWidths));
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
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(8, boxWidth - 4);

    const action = formatPermissionAction(this.request);
    const reason = formatPermissionReason(this.request);
    const { why } = formatPermissionWhyPolicy(this.request);

    const lines: string[] = [];
    lines.push(overlayTitleLine("Permission required", boxWidth, 33));

    const pushBoxLine = (content = "") => {
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    pushBoxLine(`${A.bold}${action}${A.reset}`);

    for (const line of wrapTextWithAnsi(reason, innerWidth)) {
      pushBoxLine(A.fg(250, line));
    }

    if (why) {
      pushBoxLine("");
      for (const line of wrapTextWithAnsi(`${A.dim}Why:${A.reset} ${why}`, innerWidth)) {
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
    lines.push(overlayBottomBorder(boxWidth));

    return lines;
  }
}

/** Plain widths for tests — every row should match boxWidth. */
export function measurePermissionOverlayPlainWidths(
  request: PermissionRequest,
  terminalWidth: number
): number[] {
  const overlay = new PermissionOverlay(request);
  overlay.setMeasureTerminalWidth(terminalWidth);
  const lines = overlay.render(terminalWidth);
  return lines.map((l) => visibleWidth(stripAnsi(l)));
}
