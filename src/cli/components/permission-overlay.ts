import { visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import {
  getPermissionLabel,
  type PermissionRequest,
  type PermissionResponse,
} from "../../permission/index.js";
import {
  formatPermissionAction,
  formatPermissionReason,
  formatPermissionWhyPolicy,
} from "../permission-display.js";
import { overlayBoxWidth } from "../layout.js";
import type { PresentationDensity } from "../presentation-density.js";
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

const BASE_OPTIONS: Array<{ value: PermissionResponse; label: string }> = [
  { value: "reject", label: "Deny" },
  { value: "once", label: "Allow once" },
  { value: "session", label: "Allow session" },
  { value: "always", label: "Always" },
];

function sessionOptionLabel(request: PermissionRequest, wildcard: boolean): string {
  const kind = getPermissionLabel(request.permission).toLowerCase();
  if (!wildcard) return "Allow session (this only)";
  return `Allow session (all ${kind})`;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export class PermissionOverlay implements Component {
  private request: PermissionRequest;
  private selectedIndex = 1;
  private sessionWildcard = false;
  private confirmAlways = false;
  private measureTerminalWidth: number | null = null;
  private readonly presentationDensity: PresentationDensity;

  onDecision?: (
    response: PermissionResponse,
    opts?: { wildcard?: boolean }
  ) => void;

  constructor(request: PermissionRequest, presentationDensity: PresentationDensity = "compact") {
    this.request = request;
    this.presentationDensity = presentationDensity;
  }

  setRequest(request: PermissionRequest): void {
    this.request = request;
    this.selectedIndex = 1;
    this.sessionWildcard = false;
    this.confirmAlways = false;
  }

  private options(): Array<{ value: PermissionResponse; label: string }> {
    return BASE_OPTIONS.map((option) =>
      option.value === "session"
        ? { ...option, label: sessionOptionLabel(this.request, this.sessionWildcard) }
        : option
    );
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

    const optionLine = this.options()
      .map((o) => `[ ${o.label} ]`)
      .join("   ");
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

    if (data === "\x1b[Z") {
      const options = this.options();
      if (options[this.selectedIndex]?.value === "session") {
        this.sessionWildcard = !this.sessionWildcard;
        return;
      }
    }

    const optionCount = this.confirmAlways ? 2 : this.options().length;

    if (data === "\x1b[D") {
      this.selectedIndex = (this.selectedIndex - 1 + optionCount) % optionCount;
      return;
    }

    if (data === "\x1b[C" || data === "\t") {
      this.selectedIndex = (this.selectedIndex + 1) % optionCount;
      return;
    }

    if (data === "\r") {
      if (this.confirmAlways) {
        if (this.selectedIndex === 0) {
          this.onDecision?.("always");
        } else {
          this.confirmAlways = false;
          this.selectedIndex = 1;
        }
        return;
      }
      const options = this.options();
      const choice = options[this.selectedIndex]!.value;
      if (choice === "always") {
        this.confirmAlways = true;
        this.selectedIndex = 0;
        return;
      }
      if (choice === "session" && this.sessionWildcard) {
        this.onDecision?.(choice, { wildcard: true });
      } else {
        this.onDecision?.(choice);
      }
      return;
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(8, boxWidth - 4);

    const lines: string[] = [];
    lines.push(overlayTitleLine("Permission required", boxWidth, 33));

    const pushBoxLine = (content = "") => {
      if (!content && this.presentationDensity === "compact") return;
      lines.push(overlaySideLine(content, innerWidth, boxWidth));
    };

    if (this.confirmAlways) {
      const kind = getPermissionLabel(this.request.permission).toLowerCase();
      pushBoxLine(`${A.bold}Confirm: always allow ${kind}?${A.reset}`);
      pushBoxLine("");
      const confirmOptions = [
        { label: "Yes", selected: this.selectedIndex === 0 },
        { label: "Back", selected: this.selectedIndex === 1 },
      ];
      const optionLine = confirmOptions
        .map((option) =>
          option.selected
            ? `${A.bg(39, A.fg(16, ` ${option.label} `))}`
            : `${A.fg(250, `[ ${option.label} ]`)}`
        )
        .join("   ");
      for (const line of wrapTextWithAnsi(optionLine, innerWidth)) {
        pushBoxLine(line);
      }
      pushBoxLine("");
      pushBoxLine(`${A.dim}←/→ choose   Enter confirm   Esc deny${A.reset}`);
      lines.push(overlayBottomBorder(boxWidth));
      return lines;
    }

    const action = formatPermissionAction(this.request);
    const reason = formatPermissionReason(this.request);
    const { why } = formatPermissionWhyPolicy(this.request);

    const boundary = typeof this.request.metadata?.["executionBoundary"] === "string"
      ? String(this.request.metadata["executionBoundary"])
      : "HOST";
    const policy = typeof this.request.metadata?.["approvalPolicy"] === "string"
      ? String(this.request.metadata["approvalPolicy"])
      : "PROMPT";
    pushBoxLine(`${A.dim}${boundary} · ${policy}${A.reset}`);
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

    const options = this.options();
    const optionLine = options.map((option, index) => {
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
    const sessionSelected = options[this.selectedIndex]?.value === "session";
    const footer = sessionSelected
      ? "←/→ choose   Shift+Tab: this only ↔ all   Enter confirm   Esc deny"
      : "←/→ choose   Enter confirm   Esc deny";
    pushBoxLine(`${A.dim}${footer}${A.reset}`);
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
