import {
  Editor,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type TUI,
} from "@mariozechner/pi-tui";
import type { UserProfile } from "../../util/config.js";
import {
  intrinsicFramedBoxWidth,
  overlayAnsi,
  overlayBottomBorder,
  overlayDim,
  overlayEmptyLine,
  overlayMuted,
  overlayRenderBoxWidth,
  overlaySideLine,
  overlayTitleLine,
} from "./overlay-theme.js";

export interface ProfileOverlayOptions {
  profile?: UserProfile;
  tui: TUI;
}

/** Passthrough theme — profile overlay draws its own chrome via overlay-theme helpers. */
const NOOP_EDITOR_THEME: EditorTheme = {
  borderColor: (s: string) => s,
  selectList: {
    selectedPrefix: (s: string) => s,
    selectedText: (s: string) => s,
    description: (s: string) => s,
    scrollInfo: (s: string) => s,
    noMatch: (s: string) => s,
  },
};

function fieldLines(
  label: string,
  value: string,
  innerWidth: number
): string[] {
  const prefix = `${overlayDim(`${label}:`)} `;
  const prefixWidth = visibleWidth(stripAnsi(prefix));
  const wrapped = wrapTextWithAnsi(
    value || overlayMuted("(not set)"),
    Math.max(8, innerWidth - prefixWidth)
  );
  const lines: string[] = [];
  for (let i = 0; i < wrapped.length; i++) {
    const part = wrapped[i]!;
    lines.push(i === 0 ? `${prefix}${part}` : `${" ".repeat(prefixWidth)}${part}`);
  }
  return lines.length > 0 ? lines : [`${prefix}${overlayMuted("(not set)")}`];
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export class ProfileOverlay implements Component {
  private tui: TUI;
  private profile?: UserProfile;
  private selectedAction = 0;
  private measureTerminalWidth: number | null = null;
  private mode: "view" | "editInstructions" = "view";
  private instructionsEditor: Editor | null = null;
  private readonly actions = [
    { key: "edit", label: "Edit profile", hint: "e or Enter" },
    { key: "instructions", label: "Edit instructions", hint: "i" },
    { key: "close", label: "Close", hint: "Esc" },
  ] as const;

  onEdit?: () => void;
  onCancel?: () => void;
  /** Called with the new text when the inline instructions editor is saved (Ctrl+S). */
  onSaveInstructions?: (text: string) => void;

  constructor(opts: ProfileOverlayOptions) {
    this.tui = opts.tui;
    if (opts.profile !== undefined) {
      this.profile = opts.profile;
    }
  }

  /** Refresh the displayed profile without recreating the overlay (used after a save). */
  setProfile(profile: UserProfile): void {
    this.profile = profile;
  }

  setMeasureTerminalWidth(cols: number): void {
    this.measureTerminalWidth = cols;
  }

  preferredBoxWidth(terminalWidth: number): number {
    const terminal = this.measureTerminalWidth ?? terminalWidth;
    const name = this.profile?.name?.trim() ?? "";
    const instructions = this.profile?.customInstructions?.trim() ?? "";
    const widths: number[] = [
      visibleWidth(`name: ${name || "(not set)"}`),
      visibleWidth(instructions || "(none)"),
      visibleWidth("  > Edit instructions  i"),
      visibleWidth("↑/↓ navigate   e: edit   i: instructions   Esc: close"),
    ];
    return intrinsicFramedBoxWidth(terminal, "User profile", widths);
  }

  invalidate(): void {
    this.instructionsEditor?.invalidate();
  }

  private enterEditInstructions(): void {
    this.mode = "editInstructions";
    const editor = new Editor(this.tui, NOOP_EDITOR_THEME, { paddingX: 0 });
    editor.disableSubmit = true;
    editor.setText(this.profile?.customInstructions ?? "");
    editor.focused = true;
    this.instructionsEditor = editor;
  }

  private handleInstructionsEditorInput(data: string): void {
    if (data === "\x1b") {
      // Esc discards in-progress edits and returns to the view.
      this.mode = "view";
      this.instructionsEditor = null;
      return;
    }

    if (data === "\x13") {
      // Ctrl+S saves.
      const text = this.instructionsEditor?.getExpandedText() ?? "";
      this.mode = "view";
      this.instructionsEditor = null;
      this.onSaveInstructions?.(text);
      return;
    }

    this.instructionsEditor?.handleInput(data);
  }

  handleInput(data: string): void {
    if (this.mode === "editInstructions") {
      this.handleInstructionsEditorInput(data);
      return;
    }

    if (data === "\x1b") {
      this.onCancel?.();
      return;
    }

    if (data === "\x1b[A") {
      this.selectedAction = Math.max(0, this.selectedAction - 1);
      return;
    }

    if (data === "\x1b[B") {
      this.selectedAction = Math.min(
        this.actions.length - 1,
        this.selectedAction + 1
      );
      return;
    }

    if (data === "i" || data === "I") {
      this.enterEditInstructions();
      return;
    }

    if (data === "e" || data === "E" || data === "\r") {
      if (this.selectedAction === 0) {
        this.onEdit?.();
      } else if (this.selectedAction === 1) {
        this.enterEditInstructions();
      } else {
        this.onCancel?.();
      }
      return;
    }

    if (data === "n" || data === "N") {
      this.onCancel?.();
    }
  }

  render(width: number): string[] {
    const boxWidth = overlayRenderBoxWidth(width);
    const innerWidth = Math.max(20, boxWidth - 4);

    if (this.mode === "editInstructions") {
      return this.renderEditInstructions(boxWidth, innerWidth);
    }

    const lines: string[] = [];

    lines.push(overlayTitleLine("User profile", boxWidth));
    lines.push(overlayEmptyLine(boxWidth));

    const name = this.profile?.name?.trim() ?? "";
    const instructions = this.profile?.customInstructions?.trim() ?? "";

    for (const inner of fieldLines("name", name, innerWidth)) {
      lines.push(overlaySideLine(inner, innerWidth, boxWidth));
    }
    lines.push(overlayEmptyLine(boxWidth));

    for (const inner of fieldLines("instructions", instructions || "(none)", innerWidth)) {
      lines.push(overlaySideLine(inner, innerWidth, boxWidth));
    }

    lines.push(overlayEmptyLine(boxWidth));

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i]!;
      const isSelected = i === this.selectedAction;
      const pointer = isSelected ? overlayAnsi.fg(39, ">") : " ";
      const label = isSelected
        ? overlayAnsi.fg(39, action.label)
        : overlayMuted(action.label);
      const row = `  ${pointer} ${label}  ${overlayDim(action.hint)}`;
      lines.push(overlaySideLine(row, innerWidth, boxWidth));
    }

    lines.push(overlayEmptyLine(boxWidth));
    lines.push(
      overlaySideLine(
        overlayDim("↑/↓ navigate   e: edit   i: instructions   Esc: close"),
        innerWidth,
        boxWidth
      )
    );
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }

  private renderEditInstructions(boxWidth: number, innerWidth: number): string[] {
    const lines: string[] = [];
    lines.push(overlayTitleLine("Edit custom instructions", boxWidth));
    lines.push(overlayEmptyLine(boxWidth));

    const editorLines = this.instructionsEditor?.render(innerWidth) ?? [""];
    for (const line of editorLines) {
      lines.push(overlaySideLine(line, innerWidth, boxWidth));
    }

    lines.push(overlayEmptyLine(boxWidth));
    lines.push(
      overlaySideLine(
        overlayDim("Enter: newline   Ctrl+S: save   Esc: cancel"),
        innerWidth,
        boxWidth
      )
    );
    lines.push(overlayBottomBorder(boxWidth));
    return lines;
  }
}
