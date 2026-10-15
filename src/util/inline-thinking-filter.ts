/**
 * Stateful inline-thinking envelope filter for streaming content deltas.
 *
 * Some providers/models emit reasoning inline in the `content` stream wrapped
 * in <think>/<thinking>/<reasoning> envelopes instead of using the separate
 * `reasoning_content` channel (observed with MiniMax Token Plan; DeepSeek-R1,
 * QwQ and Kimi via some OpenAI-compatible endpoints do the same). Left
 * unfiltered, the raw tags render as assistant prose and — in Quiet chat
 * density — every envelope reads as an AI-prose boundary, fragmenting work
 * groups into Worked-for spam (issue #153 dogfooding).
 *
 * The filter re-routes envelope contents to the thinking path so existing
 * display logic (thinking block, Quiet live line, work-group tracking) works
 * exactly as it does for native reasoning_content.
 *
 * Tags may arrive split across deltas (`<th` + `ink>`), so this is a
 * stream-aware state machine, not a regex over complete text.
 *
 * `finalBlockOnly` mode (used for <recap>): an envelope only counts as an
 * envelope when it is the FINAL block of the turn. A tag is honored only at
 * line start (inline examples mid-sentence are always prose, #167), and if
 * any non-whitespace content follows the close tag, the whole envelope is
 * re-emitted as plain prose instead of captured.
 */

const DEFAULT_TAGS = ["think", "thinking", "reasoning"] as const;

type State =
  | { mode: "text" }
  | { mode: "maybe-open"; partial: string; lineStart: boolean }
  | { mode: "inside"; tag: string; closePartial: string; insideText: string }
  | { mode: "post-close"; tag: string; insideText: string; trailingWs: string };

export type InlineThinkingChunk = {
  /** Prose for the content path (may be empty). */
  prose: string;
  /** Text captured inside an envelope (may be empty). */
  captured: string;
};

export class InlineThinkingFilter {
  private state: State = { mode: "text" };
  private readonly tags: readonly string[];
  private readonly finalBlockOnly: boolean;
  /** Stream-position marker for line-start checks across deltas. */
  private prevEndsWithNewline = true;

  /**
   * @param tags envelope tag names to capture, without angle brackets
   *        (default: think, thinking, reasoning). E.g. ["recap"] captures
   *        <recap>…</recap> envelopes.
   * @param finalBlockOnly only honor tags at line start AND require pure
   *        whitespace after the close (recap envelopes, #167).
   */
  constructor(tags: readonly string[] = DEFAULT_TAGS, opts?: { finalBlockOnly?: boolean }) {
    this.tags = tags;
    this.finalBlockOnly = opts?.finalBlockOnly ?? false;
  }

  /** Feed one content delta; get back prose and captured envelope text. */
  push(delta: string): InlineThinkingChunk {
    if (!delta) return { prose: "", captured: "" };

    let prose = "";
    let captured = "";
    let rest = delta;

    while (rest.length > 0) {
      if (this.state.mode === "text") {
        const open = this.findOpenTag(rest);
        if (open.index >= 0) {
          if (this.finalBlockOnly && !this.lineStartAt(rest, open.index)) {
            // Inline example mid-sentence ("get that `<recap>` line") — this
            // is prose, not an envelope (#167). Emit through the tag and keep
            // scanning for a real envelope later in the stream.
            prose += rest.slice(0, open.index + open.tag.length + 2);
            this.prevEndsWithNewline = false;
            rest = rest.slice(open.index + open.tag.length + 2);
            continue;
          }
          prose += rest.slice(0, open.index);
          this.prevEndsWithNewline = false;
          this.state = { mode: "inside", tag: open.tag, closePartial: "", insideText: "" };
          rest = rest.slice(open.index + open.tag.length + 2);
        } else {
          // Buffer a trailing partial-tag tail (e.g. "<th") until the next
          // delta resolves it. Only ever delays a few characters; if it never
          // becomes a tag, flush() or the next maybe-open pass emits it.
          const tail = partialTail(rest, (t) =>
            this.tags.some((tag) => `<${tag}`.startsWith(t))
          );
          const emitted = rest.slice(0, rest.length - tail.length);
          prose += emitted;
          if (emitted.length > 0) {
            this.prevEndsWithNewline = emitted.endsWith("\n");
          }
          if (tail.length > 0) {
            this.state = {
              mode: "maybe-open",
              partial: tail,
              lineStart: this.lineStartAt(rest, rest.length - tail.length),
            };
          }
          rest = "";
        }
        continue;
      }

      if (this.state.mode === "maybe-open") {
        const lineStart = this.state.lineStart;
        const combined = this.state.partial + rest;
        const open = this.findOpenTag(combined);
        if (open.index === 0 && (!this.finalBlockOnly || lineStart)) {
          this.state = { mode: "inside", tag: open.tag, closePartial: "", insideText: "" };
          rest = combined.slice(open.tag.length + 2);
        } else {
          // Not a tag opening here (or not at line start in finalBlockOnly
          // mode) — reprocess as text from the combined string so a later
          // partial tail in the same text still buffers.
          this.state = { mode: "text" };
          rest = combined;
        }
        continue;
      }

      if (this.state.mode === "post-close") {
        const s = this.state;
        if (/\S/.test(rest)) {
          // Non-whitespace after the close → this was never an envelope.
          // Re-emit the whole thing as prose, in original order (#167).
          prose += `<${s.tag}>${s.insideText}</${s.tag}>${s.trailingWs}`;
          this.state = { mode: "text" };
          continue;
        }
        // Only whitespace so far — hold until the turn ends or prose invalidates.
        this.state = { ...s, trailingWs: s.trailingWs + rest };
        rest = "";
        continue;
      }

      // inside an envelope
      const tag = this.state.tag;
      const closeTag = `</${tag}>`;
      const haystack = this.state.closePartial + rest;
      const closeIdx = haystack.indexOf(closeTag);
      if (closeIdx >= 0) {
        const inside = this.state.insideText + haystack.slice(0, closeIdx);
        if (this.finalBlockOnly) {
          this.state = { mode: "post-close", tag, insideText: inside, trailingWs: "" };
        } else {
          captured += inside;
          this.state = { mode: "text" };
        }
        rest = haystack.slice(closeIdx + closeTag.length);
      } else {
        const tail = partialTail(haystack, (t) => closeTag.startsWith(t));
        const consumed = haystack.slice(0, haystack.length - tail.length);
        if (this.finalBlockOnly) {
          this.state = {
            mode: "inside",
            tag,
            closePartial: tail,
            insideText: this.state.insideText + consumed,
          };
        } else {
          captured += consumed;
          this.state = { mode: "inside", tag, closePartial: tail, insideText: "" };
        }
        rest = "";
      }
    }

    return { prose, captured };
  }

  /**
   * Flush at stream end. A buffered maybe-open partial was never a tag —
   * emit it as prose. In finalBlockOnly mode: an unclosed envelope was prose
   * all along (re-emit with its open tag); a validated post-close envelope
   * is the actual capture.
   */
  flush(): InlineThinkingChunk {
    if (this.state.mode === "maybe-open") {
      const partial = this.state.partial;
      this.state = { mode: "text" };
      return { prose: partial, captured: "" };
    }
    if (this.state.mode === "post-close") {
      const captured = this.state.insideText;
      this.state = { mode: "text" };
      return { prose: "", captured };
    }
    if (this.state.mode === "inside") {
      const { tag, closePartial, insideText } = this.state;
      this.state = { mode: "text" };
      if (this.finalBlockOnly) {
        // Unclosed <recap> — not a valid envelope; everything was prose.
        return { prose: `<${tag}>${insideText}${closePartial}`, captured: "" };
      }
      return { prose: "", captured: closePartial };
    }
    return { prose: "", captured: "" };
  }

  private findOpenTag(text: string): { index: number; tag: string } {
    let best = -1;
    let bestTag = "";
    for (const tag of this.tags) {
      const idx = text.indexOf(`<${tag}>`);
      if (idx >= 0 && (best < 0 || idx < best)) {
        best = idx;
        bestTag = tag;
      }
    }
    return { index: best, tag: bestTag };
  }

  /** True when position `index` begins a line (after \n or stream start, spaces allowed). */
  private lineStartAt(text: string, index: number): boolean {
    for (let i = index - 1; i >= 0; i--) {
      const ch = text[i]!;
      if (ch === " " || ch === "\t") continue;
      return ch === "\n";
    }
    return this.prevEndsWithNewline;
  }
}

/**
 * Longest suffix of `text` (1..maxTagLen-1 chars) that could still grow into
 * a tag prefix, verified by `matches`. Used to hold back split tags.
 */
function partialTail(text: string, matches: (candidate: string) => boolean): string {
  const maxLen = Math.min("</reasoning>".length - 1, text.length);
  for (let len = maxLen; len > 0; len--) {
    const candidate = text.slice(text.length - len);
    if (matches(candidate)) return candidate;
  }
  return "";
}
