/**
 * Spinner — animated status line while agent is working.
 *
 * Uses Braille frames + rotating fun phrases.
 * Always writes with \r so it overwrites itself on the same line.
 * Call clear() to erase it before writing any other output.
 */

const BRAILLE = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"] as const;

const PHRASES = [
  "composing logic…",
  "traversing the AST…",
  "reasoning about types…",
  "consulting the docs…",
  "diffing reality…",
  "compiling intentions…",
  "thinking in packets…",
  "allocating neurons…",
  "parsing intent…",
  "checking the stack…",
  "optimising thoughts…",
  "connecting nodes…",
  "resolving dependencies…",
  "inspecting the heap…",
  "indexing the codebase…",
  "assembling context…",
  "untangling recursion…",
  "negotiating with the API…",
];

const DIM   = "\x1b[2m";
const RESET = "\x1b[0m";

export class Spinner {
  private frame  = 0;
  private phraseIdx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private customPhrase: string | null = null;

  start(phrase?: string): void {
    if (this.active) this.clear();
    this.active = true;
    this.customPhrase = phrase ?? null;
    this.frame = 0;

    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % BRAILLE.length;
      if (this.frame === 0) {
        this.phraseIdx = (this.phraseIdx + 1) % PHRASES.length;
      }
      const p = this.customPhrase ?? PHRASES[this.phraseIdx] ?? "working…";
      const b = BRAILLE[this.frame] ?? "⠋";
      process.stdout.write(`\r  ${DIM}${b}  ${p}${RESET}`);
    }, 80);
  }

  /** Set a custom phrase without restarting */
  setPhrase(phrase: string): void {
    this.customPhrase = phrase;
  }

  /** Erase the spinner line. Always call before writing other output. */
  clear(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.active) process.stdout.write("\r\x1b[2K");
    this.active = false;
    this.customPhrase = null;
  }

  get isActive(): boolean { return this.active; }
}
