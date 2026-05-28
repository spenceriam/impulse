/**
 * Session-scoped submitted prompt recall (Up arrow).
 */

export class PromptHistory {
  private entries: string[] = [];
  /** -1 = at end (not browsing); otherwise index into entries */
  private index = -1;

  push(text: string): void {
    const t = text.trim();
    if (!t) return;
    const last = this.entries[this.entries.length - 1];
    if (last === t) return;
    this.entries.push(t);
    this.index = -1;
  }

  /** Older entry on repeated Up; null when empty. */
  previous(): string | null {
    if (this.entries.length === 0) return null;
    if (this.index === -1) {
      this.index = this.entries.length - 1;
    } else if (this.index > 0) {
      this.index -= 1;
    }
    return this.entries[this.index] ?? null;
  }

  resetIndex(): void {
    this.index = -1;
  }

  reset(): void {
    this.entries = [];
    this.index = -1;
  }

  /** Test helper */
  size(): number {
    return this.entries.length;
  }
}
