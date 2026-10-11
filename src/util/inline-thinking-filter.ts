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
 */

const DEFAULT_TAGS = ["think", "thinking", "reasoning"] as const;

type State =
  | { mode: "text" }
  | { mode: "maybe-open"; partial: string }
  | { mode: "inside"; tag: string; closePartial: string };

export type InlineThinkingChunk = {
  /** Prose for the content path (may be empty). */
  prose: string;
  /** Text captured inside an envelope (may be empty). */
  captured: string;
};

export class InlineThinkingFilter {
  private state: State = { mode: "text" };
  private readonly tags: readonly string[];

  /**
   * @param tags envelope tag names to capture, without angle brackets
   *        (default: think, thinking, reasoning). E.g. ["recap"] captures
   *        <recap>…</recap> envelopes.
   */
  constructor(tags: readonly string[] = DEFAULT_TAGS) {
    this.tags = tags;
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
          prose += rest.slice(0, open.index);
          this.state = { mode: "inside", tag: open.tag, closePartial: "" };
          rest = rest.slice(open.index + open.tag.length + 2);
        } else {
          // Buffer a trailing partial-tag tail (e.g. "<th") until the next
          // delta resolves it. Only ever delays a few characters; if it never
          // becomes a tag, flush() or the next maybe-open pass emits it.
          const tail = partialTail(rest, (t) =>
            this.tags.some((tag) => `<${tag}`.startsWith(t))
          );
          prose += rest.slice(0, rest.length - tail.length);
          if (tail.length > 0) this.state = { mode: "maybe-open", partial: tail };
          rest = "";
        }
        continue;
      }

      if (this.state.mode === "maybe-open") {
        const combined = this.state.partial + rest;
        const open = this.findOpenTag(combined);
        if (open.index === 0) {
          this.state = { mode: "inside", tag: open.tag, closePartial: "" };
          rest = combined.slice(open.tag.length + 2);
        } else {
          // Not a tag opening here — reprocess as text from the combined
          // string so a later partial tail in the same text still buffers.
          this.state = { mode: "text" };
          rest = combined;
        }
        continue;
      }

      // inside an envelope
      const closeTag = `</${this.state.tag}>`;
      const haystack = this.state.closePartial + rest;
      const closeIdx = haystack.indexOf(closeTag);
      if (closeIdx >= 0) {
        captured += haystack.slice(0, closeIdx);
        this.state = { mode: "text" };
        rest = haystack.slice(closeIdx + closeTag.length);
      } else {
        const tail = partialTail(haystack, (t) => closeTag.startsWith(t));
        captured += haystack.slice(0, haystack.length - tail.length);
        this.state = { mode: "inside", tag: this.state.tag, closePartial: tail };
        rest = "";
      }
    }

    return { prose, captured };
  }

  /**
   * Flush at stream end. A buffered maybe-open partial was never a tag —
   * emit it as prose. An unclosed envelope's buffered close-partial belongs
   * to the captured side.
   */
  flush(): InlineThinkingChunk {
    if (this.state.mode === "maybe-open") {
      const partial = this.state.partial;
      this.state = { mode: "text" };
      return { prose: partial, captured: "" };
    }
    if (this.state.mode === "inside") {
      const partial = this.state.closePartial;
      this.state = { mode: "text" };
      return { prose: "", captured: partial };
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
