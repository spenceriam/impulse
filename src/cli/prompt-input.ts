/**
 * Prompt input with paste tokens, ordered segment assembly, and image detection.
 */

import {
  Editor,
  matchesKey,
  truncateToWidth,
  type EditorTheme,
  type Component,
  type Focusable,
} from "@mariozechner/pi-tui";
import { GUTTER, gutterContent, innerWidth, maxLineWidth, truncateGutterLine } from "./gutter.js";
import {
  extractImagePathRefs,
  filePathInPasteRegex,
  isImagePathCandidate,
  resolveImagePath,
} from "./image-paths.js";

export type PasteGroup = {
  display: string;
  content: string;
  originalDisplay: string;
  kind: "text" | "image";
  imageIndex?: number;
};

type PasteSpan = { start: number; len: number; group: PasteGroup };

type EditorWithCursor = Editor & {
  state: { cursorLine: number; cursorCol: number };
};

export type PromptSegment =
  | { kind: "text"; value: string }
  | { kind: "paste"; display: string; content: string }
  | { kind: "image"; index: number; display: string; uri: string };

export type PromptSubmitPayload = {
  /** What the user saw in the editor (tokens preserved) */
  displayMessage: string;
  /** Expanded text for non-multimodal APIs */
  apiText: string;
  segments: PromptSegment[];
  orderedImages: Array<{ index: number; uri: string; display: string }>;
};

const IMAGE_DISPLAY_RE = /\[Pasted images? #(\d+)(?:-#(\d+))?\]/g;

/** Walk editor text and split into ordered segments by paste token positions. */
export function buildPromptSegments(
  editorText: string,
  groups: PasteGroup[]
): PromptSegment[] {
  if (groups.length === 0) {
    return editorText.length > 0 ? [{ kind: "text", value: editorText }] : [];
  }

  // Match paste groups in array order (left-to-right). Each group consumes the
  // next occurrence of its display token so identical markers map to distinct content.
  const segments: PromptSegment[] = [];
  let pos = 0;

  for (const g of groups) {
    const idx = editorText.indexOf(g.display, pos);
    if (idx === -1) continue;

    if (idx > pos) {
      segments.push({ kind: "text", value: editorText.slice(pos, idx) });
    }
    if (g.kind === "image" && g.imageIndex !== undefined) {
      segments.push({
        kind: "image",
        index: g.imageIndex,
        display: g.display,
        uri: g.content,
      });
    } else {
      segments.push({ kind: "paste", display: g.display, content: g.content });
    }
    pos = idx + g.display.length;
  }

  if (pos < editorText.length) {
    segments.push({ kind: "text", value: editorText.slice(pos) });
  }

  return segments;
}

export function segmentsToApiText(segments: PromptSegment[]): string {
  let out = "";
  for (const seg of segments) {
    if (seg.kind === "text") out += seg.value;
    else if (seg.kind === "paste") out += seg.content;
    else if (seg.kind === "image") out += seg.display;
  }
  return out;
}

export function segmentsToOrderedImages(
  segments: PromptSegment[]
): Array<{ index: number; uri: string; display: string }> {
  const images: Array<{ index: number; uri: string; display: string }> = [];
  for (const seg of segments) {
    if (seg.kind === "image") {
      images.push({ index: seg.index, uri: seg.uri, display: seg.display });
    }
  }
  return images;
}

type MultimodalPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Build API user content from segments. */
export function buildUserMessageContent(
  segments: PromptSegment[],
  nativeVision: boolean
): string | MultimodalPart[] {
  if (!nativeVision) {
    return segmentsToApiText(segments);
  }

  const parts: MultimodalPart[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      if (seg.value.length > 0) parts.push({ type: "text", text: seg.value });
    } else if (seg.kind === "paste") {
      parts.push({ type: "text", text: seg.content });
    } else if (seg.kind === "image") {
      parts.push({ type: "image_url", image_url: { url: seg.uri } });
    }
  }

  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0]!.type === "text") return parts[0]!.text;
  return parts;
}

/**
 * After path attachment, use refreshed payload only when editor text changed.
 * Preserves slash-command payload when the editor was cleared before handling.
 */
export function resolveSubmitPayloadAfterPathAttach(
  initial: PromptSubmitPayload,
  editorText: string,
  getFreshPayload: () => PromptSubmitPayload
): PromptSubmitPayload {
  const trimmed = editorText.trim();
  const initialTrim = initial.displayMessage.trim();
  if (trimmed && trimmed !== initialTrim) {
    return getFreshPayload();
  }
  return initial;
}

export function buildSubmitPayload(editorText: string, groups: PasteGroup[]): PromptSubmitPayload {
  const segments = buildPromptSegments(editorText, groups);
  return {
    displayMessage: editorText,
    apiText: segmentsToApiText(segments),
    segments,
    orderedImages: segmentsToOrderedImages(segments),
  };
}

/** Chat transcript / history text: expand collapsed paste tokens to full apiText. */
export function userTranscriptText(payload: PromptSubmitPayload): string {
  const hasTextPaste = payload.segments.some((s) => s.kind === "paste");
  return hasTextPaste ? payload.apiText : payload.displayMessage;
}

export class PromptInput implements Component, Focusable {
  focused = false;

  private editor: Editor;
  /** @deprecated Arrow uses dim styling; mode color is context-bar only. */
  private _modeColorCode = 34;
  private _pasteGroups: PasteGroup[] = [];
  private _detectedImages: string[] = [];
  private _nextImageIndex = 1;
  private _nextTextPasteSeq = 1;
  private _isPasting = false;
  private _pasteBuffer = "";
  private _secretMode = false;

  onTabForward?: () => void;
  onTabBackward?: () => void;
  onAbort?: () => void;
  onExit?: () => void;
  onEscape?: () => void;
  onChange?: (value: string) => void;
  onArrowUp?: (() => void) | null;
  onArrowDown?: (() => void) | null;
  onArrowLeft?: (() => void) | null;
  onArrowRight?: (() => void) | null;
  onEnter?: (() => void) | null;

  constructor(tui?: { terminal: { rows: number; columns: number } }, theme?: EditorTheme) {
    const t = tui ?? { terminal: { rows: 24, columns: 80 } };
    this.editor = new Editor(t, theme ?? ({} as EditorTheme), { paddingX: 0 });
  }

  /** No-op: prompt chevron uses dim styling to match separator lines. */
  setModeColor(_code: number): void {
    this._modeColorCode = _code;
  }
  setSecretMode(enabled: boolean): void {
    this._secretMode = enabled;
  }
  getEditor(): Editor {
    return this.editor;
  }

  private _submitPayload: PromptSubmitPayload | null = null;

  get onSubmit() {
    return this.editor.onSubmit;
  }
  set onSubmit(fn: ((payload: PromptSubmitPayload) => void) | undefined) {
    if (fn !== undefined) {
      this.editor.onSubmit = () => fn(this._submitPayload ?? this.getSubmitPayload());
    } else {
      this.editor.onSubmit = undefined as unknown as (value: string) => void;
    }
  }

  /** @deprecated use getSubmitPayload */
  getSubmitValue(): string {
    return this.getSubmitPayload().apiText;
  }

  getSubmitPayload(): PromptSubmitPayload {
    let displayed = this.editor.getText();
    if (displayed.length === 0 && this._submitPayload !== null) {
      return this._submitPayload;
    }
    return buildSubmitPayload(displayed, this._pasteGroups);
  }

  clear(): void {
    this.editor.setText("");
    this._pasteGroups = [];
    this._detectedImages = [];
    this._nextImageIndex = 1;
    this._nextTextPasteSeq = 1;
    this._isPasting = false;
    this._pasteBuffer = "";
    this._submitPayload = null;
  }

  getImages(): string[] {
    return this._detectedImages;
  }

  getOrderedImages(): Array<{ index: number; uri: string; display: string }> {
    return this.getSubmitPayload().orderedImages;
  }

  /**
   * Resolve file/@ paths in the editor into [Pasted image #N] tokens.
   * Mutates editor text and paste groups. Returns error messages for missing files.
   */
  async attachImagePathsFromEditor(cwd: string = process.cwd()): Promise<string[]> {
    const errors: string[] = [];
    let text = this.editor.getText();
    const refs = extractImagePathRefs(text);
    if (refs.length === 0) return errors;

    type ResolvedPair = {
      ref: typeof refs[number];
      group: PasteGroup;
      label: string;
    };
    const resolvedPairs: ResolvedPair[] = [];

    for (const ref of refs) {
      const resolved = await resolveImagePath(ref.path, cwd);
      if (!resolved.ok) {
        errors.push(resolved.reason);
        continue;
      }

      const idx = this._nextImageIndex;
      const label = `[Pasted image #${idx}]`;
      const group: PasteGroup = {
        display: label,
        content: resolved.uri,
        originalDisplay: label,
        kind: "image",
        imageIndex: idx,
      };
      this._detectedImages.push(resolved.uri);
      this._nextImageIndex = idx + 1;

      resolvedPairs.push({ ref, group, label });
    }

    for (const { ref, label } of [...resolvedPairs].reverse()) {
      text = text.slice(0, ref.start) + label + text.slice(ref.end);
    }

    for (const { group } of resolvedPairs) {
      this._pasteGroups.push(group);
    }

    this.editor.setText(text);
    this._syncPasteGroupsAfterEdit();

    return errors;
  }

  private _detectImages(content: string): number {
    let found = 0;
    const base64Regex = /data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+/gi;
    const base64Matches = content.match(base64Regex);
    if (base64Matches) {
      for (const match of base64Matches) {
        if (!this._detectedImages.includes(match)) {
          this._detectedImages.push(match);
          found++;
        }
      }
    }

    const fileRegex = filePathInPasteRegex();
    const fileMatches = content.match(fileRegex);
    if (fileMatches) {
      for (const match of fileMatches) {
        if (!this._detectedImages.includes(match)) {
          this._detectedImages.push(match);
          found++;
        }
      }
    }

    return found;
  }

  private _findGroupInText(
    text: string,
    group: PasteGroup,
    searchFrom = 0
  ): { start: number; len: number } | null {
    let idx = text.indexOf(group.display, searchFrom);
    if (idx !== -1) return { start: idx, len: group.display.length };

    idx = text.indexOf(group.originalDisplay, searchFrom);
    if (idx !== -1) return { start: idx, len: group.originalDisplay.length };

    // Image tokens must match exactly — prefix fallback would match `#1` inside `#2`.
    if (group.kind === "image") return null;

    idx = text.indexOf(group.originalDisplay.slice(0, 8), searchFrom);
    while (idx !== -1) {
      let spanLength = 0;
      while (
        spanLength < group.originalDisplay.length &&
        idx + spanLength < text.length &&
        text[idx + spanLength] === group.originalDisplay[spanLength]
      ) {
        spanLength++;
      }
      if (spanLength >= 8) {
        if (spanLength < group.originalDisplay.length) {
          const expected = group.originalDisplay[spanLength]!;
          const actual = text[idx + spanLength];
          if (expected !== actual) {
            const atEnd = idx + spanLength >= text.length;
            // Wrong seq digit (#1 vs #2), or mid-token mismatch — skip this occurrence.
            if (!atEnd && expected !== "]") {
              idx = text.indexOf(group.originalDisplay.slice(0, 8), idx + 1);
              continue;
            }
          }
        }
        return { start: idx, len: spanLength };
      }
      idx = text.indexOf(group.originalDisplay.slice(0, 8), idx + 1);
    }

    return null;
  }

  private _syncPasteGroupsAfterEdit(): void {
    const prevTextCount = this._pasteGroups.filter((g) => g.kind === "text").length;
    const text = this.editor.getText();
    const remaining: PasteGroup[] = [];
    const removedImageUriIndices: number[] = [];
    let pos = 0;

    for (const group of this._pasteGroups) {
      const match = this._findGroupInText(text, group, pos);
      if (!match) {
        if (group.kind === "image" && group.imageIndex !== undefined) {
          removedImageUriIndices.push(group.imageIndex - 1);
        }
        continue;
      }

      const slice = text.slice(match.start, match.start + match.len);
      remaining.push({ ...group, display: slice });
      pos = match.start + match.len;
    }

    for (const uriIdx of [...new Set(removedImageUriIndices)].sort((a, b) => b - a)) {
      if (uriIdx >= 0 && uriIdx < this._detectedImages.length) {
        this._detectedImages.splice(uriIdx, 1);
      }
    }

    this._pasteGroups = remaining;
    if (removedImageUriIndices.length > 0) {
      this._reindexImageGroups();
    }
    const newTextCount = remaining.filter((g) => g.kind === "text").length;
    if (newTextCount < prevTextCount) {
      this._reindexTextPasteSeq();
    }
  }

  private _textPasteSeqFromDisplay(display: string): number | null {
    const m = display.match(/#(\d+)\]$/);
    return m ? parseInt(m[1]!, 10) : null;
  }

  private _reindexTextPasteSeq(): void {
    let max = 0;
    for (const group of this._pasteGroups) {
      if (group.kind !== "text") continue;
      const n = this._textPasteSeqFromDisplay(group.originalDisplay);
      if (n !== null) max = Math.max(max, n);
    }
    this._nextTextPasteSeq = max > 0 ? max + 1 : 1;
  }

  private _cursorOffsetInText(): number {
    const { line, col } = this.editor.getCursor();
    const lines = this.editor.getLines();
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      offset += lines[i]!.length + 1;
    }
    const current = lines[line] ?? "";
    return offset + Math.min(col, current.length);
  }

  private _setCursorOffset(offset: number): void {
    const text = this.editor.getText();
    const o = Math.max(0, Math.min(offset, text.length));
    const lines = text.split("\n");
    let remaining = o;
    let line = 0;
    let col = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i]!.length;
      if (remaining <= lineLen) {
        line = i;
        col = remaining;
        break;
      }
      remaining -= lineLen + 1;
      if (i === lines.length - 1) {
        line = i;
        col = lineLen;
      }
    }
    const ed = this.editor as EditorWithCursor;
    ed.state.cursorLine = line;
    ed.state.cursorCol = col;
  }

  private _collectPasteSpans(text: string): PasteSpan[] {
    const spans: PasteSpan[] = [];
    let pos = 0;
    for (const group of this._pasteGroups) {
      const match = this._findGroupInText(text, group, pos);
      if (!match) continue;
      spans.push({ ...match, group });
      pos = match.start + match.len;
    }
    return spans;
  }

  private _findPasteSpanForDelete(
    offset: number,
    kind: "backspace" | "forward"
  ): PasteSpan | null {
    const text = this.editor.getText();
    for (const span of this._collectPasteSpans(text)) {
      const end = span.start + span.len;
      if (kind === "backspace") {
        if (offset > span.start && offset <= end) return span;
      } else if (offset >= span.start && offset < end) {
        return span;
      }
    }
    return null;
  }

  private _removePasteSpan(span: PasteSpan): void {
    const text = this.editor.getText();
    const newText = text.slice(0, span.start) + text.slice(span.start + span.len);
    const { group } = span;

    if (group.kind === "image" && group.imageIndex !== undefined) {
      const uriIdx = group.imageIndex - 1;
      if (uriIdx >= 0 && uriIdx < this._detectedImages.length) {
        this._detectedImages.splice(uriIdx, 1);
      }
    }
    this._pasteGroups = this._pasteGroups.filter((g) => g !== group);

    this.editor.setText(newText);
    this._setCursorOffset(span.start);

    if (group.kind === "image") {
      this._reindexImageGroups();
    } else {
      this._reindexTextPasteSeq();
    }
    this._submitPayload = null;
    this.onChange?.(this.editor.getText());
  }

  private _tryAtomicPasteDelete(kind: "backspace" | "forward"): boolean {
    if (this._pasteGroups.length === 0) return false;
    const offset = this._cursorOffsetInText();
    const span = this._findPasteSpanForDelete(offset, kind);
    if (!span) return false;
    this._removePasteSpan(span);
    return true;
  }

  private _isBackspaceInput(data: string): boolean {
    return (
      data === "\x7f" ||
      data === "\x08" ||
      matchesKey(data, "backspace") ||
      matchesKey(data, "shift+backspace")
    );
  }

  private _isForwardDeleteInput(data: string): boolean {
    return matchesKey(data, "delete") || matchesKey(data, "shift+delete");
  }

  private _removeImageGroupAtDisplay(display: string): void {
    const group = this._pasteGroups.find((g) => g.display === display && g.kind === "image");
    if (!group || group.imageIndex === undefined) return;
    const uriIdx = group.imageIndex - 1;
    if (uriIdx >= 0 && uriIdx < this._detectedImages.length) {
      this._detectedImages.splice(uriIdx, 1);
    }
    this._pasteGroups = this._pasteGroups.filter((g) => g !== group);
    this._reindexImageGroups();
  }

  private _reindexImageGroups(): void {
    const replacements: Array<{ from: string; to: string }> = [];
    let idx = 1;
    for (const group of this._pasteGroups) {
      if (group.kind !== "image") continue;
      const oldDisplay = group.display;
      const label = `[Pasted image #${idx}]`;
      replacements.push({ from: oldDisplay, to: label });
      group.display = label;
      group.originalDisplay = label;
      group.imageIndex = idx;
      idx++;
    }
    this._nextImageIndex = idx;
    if (replacements.length === 0) return;
    let text = this.editor.getText();
    for (const { from, to } of replacements) {
      text = text.replace(from, to);
    }
    this.editor.setText(text);
  }

  handleInput(data: string): void {
    if (data.length > 1 && !data.includes("\x1b") && (data.includes("\r") || data.includes("\n"))) {
      for (const char of data) this.handleInput(char);
      return;
    }

    if (data === "\t") {
      this.onTabForward?.();
      return;
    }
    if (data === "\x1b[Z") {
      this.onTabBackward?.();
      return;
    }
    if (data === "\x03") {
      this.onAbort?.();
      return;
    }
    if (data === "\x04") {
      this.onExit?.();
      return;
    }
    if (data === "\x1b") {
      this.onEscape?.();
      return;
    }

    if (data === "\x1b[A" && this.onArrowUp) {
      this.onArrowUp();
      return;
    }
    if (data === "\x1b[B" && this.onArrowDown) {
      this.onArrowDown();
      return;
    }
    if (data === "\x1b[D" && this.onArrowLeft) {
      this.onArrowLeft();
      return;
    }
    if (data === "\x1b[C" && this.onArrowRight) {
      this.onArrowRight();
      return;
    }
    if (data === "\r" && this.onEnter) {
      this.onEnter();
      return;
    }

    if (data === "\r") {
      this._submitPayload = this.getSubmitPayload();
    }

    const hasPasteStart = data.includes("\x1b[200~");
    const hasPasteEnd = data.includes("\x1b[201~");

    if (hasPasteStart) {
      this._isPasting = true;
      const afterStart = data.slice(data.indexOf("\x1b[200~") + 6);
      const content = hasPasteEnd
        ? afterStart.slice(0, afterStart.indexOf("\x1b[201~"))
        : afterStart;
      this._pasteBuffer = content;

      if (hasPasteEnd) this._finalizePaste();
      return;
    }

    if (this._isPasting) {
      if (hasPasteEnd) {
        this._pasteBuffer += data.slice(0, data.indexOf("\x1b[201~"));
        this._finalizePaste();
      } else {
        this._pasteBuffer += data;
      }
      return;
    }

    if (this._isBackspaceInput(data)) {
      if (this._tryAtomicPasteDelete("backspace")) return;
    }
    if (this._isForwardDeleteInput(data)) {
      if (this._tryAtomicPasteDelete("forward")) return;
    }

    const beforeText = this.editor.getText();
    this.editor.handleInput(data);
    this._submitPayload = null;

    const afterText = this.editor.getText();
    if (beforeText.length > afterText.length) {
      for (const group of [...this._pasteGroups]) {
        if (group.kind === "image" && !afterText.includes(group.display)) {
          this._removeImageGroupAtDisplay(group.display);
        }
      }
    }

    this._syncPasteGroupsAfterEdit();
    this.onChange?.(this.editor.getText());
  }

  private _finalizePaste(): void {
    this._isPasting = false;
    const content = this._pasteBuffer;
    this._pasteBuffer = "";

    const lines = content.split("\n").filter((l) => l.length > 0);

    if (lines.length === 1 && isImagePathCandidate(lines[0]!)) {
      this.editor.setText(lines[0]!.trim());
      void this.attachImagePathsFromEditor().then(() => {
        this.onChange?.(this.editor.getText());
      });
      return;
    }

    const imagesBefore = this._detectedImages.length;
    const imageCount = this._detectImages(content);

    if (imageCount > 0) {
      const startIndex = this._nextImageIndex;
      const newUris = this._detectedImages.slice(imagesBefore);
      let labels = "";
      for (let i = 0; i < imageCount; i++) {
        const idx = startIndex + i;
        const label = `[Pasted image #${idx}]`;
        const uri = newUris[i] ?? content;
        this._pasteGroups.push({
          display: label,
          content: uri,
          originalDisplay: label,
          kind: "image",
          imageIndex: idx,
        });
        labels += label;
      }
      this._nextImageIndex = startIndex + imageCount;
      this.editor.handleInput(labels);
    } else if (lines.length > 1) {
      const seq = this._nextTextPasteSeq++;
      const display = `[Pasted ${lines.length} lines  ${content.length} chars #${seq}]`;
      this._pasteGroups.push({
        display,
        content,
        originalDisplay: display,
        kind: "text",
      });
      this.editor.handleInput(display);
    } else if (content.length > 120) {
      const seq = this._nextTextPasteSeq++;
      const display = `[Pasted ${content.length} chars #${seq}]`;
      this._pasteGroups.push({
        display,
        content,
        originalDisplay: display,
        kind: "text",
      });
      this.editor.handleInput(display);
    } else {
      this.editor.handleInput("\x1b[200~" + content + "\x1b[201~");
    }
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  render(width: number): string[] {
    const ARROW = `${GUTTER}\x1b[2m\u276f\x1b[0m `;
    const arrowSuffixWidth = 3;
    const editorWidth = Math.max(1, innerWidth(width) - arrowSuffixWidth);
    const rawLines = this.editor.render(editorWidth);
    const innerLines = (rawLines.length > 2 ? rawLines.slice(1, -1) : rawLines).map((l) =>
      l.replace(/\x1b_pi:c\x07/g, "")
    );
    const firstLine = innerLines[0] ?? "";
    const content = firstLine.startsWith("> ") ? firstLine.slice(2) : firstLine;
    const lineCap = maxLineWidth(width);

    if (this._secretMode) {
      const valueLength = this.editor.getText().length;
      const masked =
        valueLength > 0
          ? "*".repeat(Math.min(valueLength, Math.max(0, lineCap - ARROW.length)))
          : "";
      return [truncateGutterLine(ARROW + masked, width)];
    }

    // Ghost text hint for lone ! (shell bang mode indicator)
    if (this.editor.getText() === "!") {
      const ghostLine = ARROW + this.editor.getText() + "\x1b[38;5;238m type any terminal command\x1b[0m";
      return [
        truncateGutterLine(ghostLine, width),
        ...innerLines.slice(1).map((line) => gutterContent(line, width)),
      ];
    }

    return [
      truncateGutterLine(ARROW + content, width),
      ...innerLines.slice(1).map((line) => gutterContent(line, width)),
    ];
  }

  setText(text: string): void {
    this.editor.setText(text);
    this._syncPasteGroupsAfterEdit();
  }

  /**
   * Append side-prompt copy as plain visible editor text (not collapsed paste tokens).
   */
  injectSideCopyBlock(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    const current = this.editor.getText();
    const next =
      current.trim().length > 0 ? `${current.replace(/\s+$/, "")}\n\n${trimmed}` : trimmed;

    this.editor.setText(next);
    this._submitPayload = null;
    this.onChange?.(this.editor.getText());
  }

  getText(): string {
    return this.editor.getText();
  }
}

export { IMAGE_DISPLAY_RE };
