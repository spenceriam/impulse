/**
 * Prompt input with paste tokens, ordered segment assembly, and image detection.
 */

import {
  Editor,
  truncateToWidth,
  type EditorTheme,
  type Component,
  type Focusable,
} from "@mariozechner/pi-tui";
import { GUTTER } from "./gutter.js";

export type PasteGroup = {
  display: string;
  content: string;
  originalDisplay: string;
  kind: "text" | "image";
  imageIndex?: number;
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

export function buildSubmitPayload(editorText: string, groups: PasteGroup[]): PromptSubmitPayload {
  const segments = buildPromptSegments(editorText, groups);
  return {
    displayMessage: editorText,
    apiText: segmentsToApiText(segments),
    segments,
    orderedImages: segmentsToOrderedImages(segments),
  };
}

export class PromptInput implements Component, Focusable {
  focused = false;

  private editor: Editor;
  private _modeColorCode = 34;
  private _pasteGroups: PasteGroup[] = [];
  private _detectedImages: string[] = [];
  private _nextImageIndex = 1;
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

  setModeColor(code: number): void {
    this._modeColorCode = code;
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

    const extGroup = "(?:png|jpg|jpeg|gif|webp|bmp)";
    const fileRegex = new RegExp(
      `(?:/(?:tmp|home|var|Users)/[^\\s\\n]*\\.${extGroup}|
         [A-Za-z]:\\\\[^\\s\\n]*\\.${extGroup}|
         file:///[^\\s\\n]*\\.${extGroup})`,
      "gi"
    );
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
    group: PasteGroup
  ): { start: number; len: number } | null {
    let idx = text.indexOf(group.display);
    if (idx !== -1) return { start: idx, len: group.display.length };

    idx = text.indexOf(group.originalDisplay);
    if (idx !== -1) return { start: idx, len: group.originalDisplay.length };

    // Image tokens must match exactly — prefix fallback would match `#1` inside `#2`.
    if (group.kind === "image") return null;

    for (let len = group.originalDisplay.length - 1; len >= 8; len--) {
      const prefix = group.originalDisplay.slice(0, len);
      idx = text.indexOf(prefix);
      if (idx !== -1) return { start: idx, len: prefix.length };
    }

    return null;
  }

  private _syncPasteGroupsAfterEdit(): void {
    const text = this.editor.getText();
    const remaining: PasteGroup[] = [];
    const removedImageUriIndices: number[] = [];

    for (const group of this._pasteGroups) {
      const match = this._findGroupInText(text, group);
      if (!match) {
        if (group.kind === "image" && group.imageIndex !== undefined) {
          removedImageUriIndices.push(group.imageIndex - 1);
        }
        continue;
      }

      const slice = text.slice(match.start, match.start + match.len);
      remaining.push({ ...group, display: slice });
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
    let idx = 1;
    for (const group of this._pasteGroups) {
      if (group.kind !== "image") continue;
      const oldDisplay = group.display;
      const label = `[Pasted image #${idx}]`;
      group.display = label;
      group.originalDisplay = label;
      group.imageIndex = idx;
      group.content = group.content;
      const text = this.editor.getText();
      if (text.includes(oldDisplay)) {
        this.editor.setText(text.replace(oldDisplay, label));
      }
      idx++;
    }
    this._nextImageIndex = idx;
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

    const imagesBefore = this._detectedImages.length;
    const imageCount = this._detectImages(content);
    const lines = content.split("\n").filter((l) => l.length > 0);

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
      const display = `[Pasted ${lines.length} lines  ${content.length} chars]`;
      this._pasteGroups.push({
        display,
        content,
        originalDisplay: display,
        kind: "text",
      });
      this.editor.handleInput(display);
    } else if (content.length > 120) {
      const display = `[Pasted ${content.length} chars]`;
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
    const editorWidth = Math.max(1, width - 5);
    const rawLines = this.editor.render(editorWidth);
    const innerLines = (rawLines.length > 2 ? rawLines.slice(1, -1) : rawLines).map((l) =>
      l.replace(/\x1b_pi:c\x07/g, "")
    );
    const firstLine = innerLines[0] ?? "";
    const content = firstLine.startsWith("> ") ? firstLine.slice(2) : firstLine;
    const ARROW = `${GUTTER}\x1b[${this._modeColorCode}m\u276f\x1b[0m `;

    if (this._secretMode) {
      const valueLength = this.editor.getText().length;
      const masked =
        valueLength > 0 ? "*".repeat(Math.min(valueLength, Math.max(0, width - 4))) : "";
      return [truncateToWidth(ARROW + masked, width)];
    }

    return [
      truncateToWidth(ARROW + content, width, ""),
      ...innerLines.slice(1).map((line) => truncateToWidth(GUTTER + line, width, "")),
    ];
  }

  setText(text: string): void {
    this.editor.setText(text);
    this._syncPasteGroupsAfterEdit();
  }

  getText(): string {
    return this.editor.getText();
  }
}

export { IMAGE_DISPLAY_RE };
