/**
 * Project-scoped submitted prompt recall (Up arrow).
 */

const MAX_ENTRIES = 20;

export class PromptHistory {
  private entries: string[] = [];
  /** -1 = at end (not browsing); otherwise index into entries */
  private index = -1;
  private draft: string | null = null;

  push(text: string): void {
    const t = text.trim();
    if (!t) return;
    const last = this.entries[this.entries.length - 1];
    if (last === t) {
      this.index = -1;
      this.draft = null;
      return;
    }
    this.entries.push(t);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.index = -1;
    this.draft = null;
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

  /** Call before previous() on the first Up of a browse (index === -1). */
  saveDraft(current: string): void {
    if (this.index !== -1) return;
    this.draft = current.trim() ? current : null;
  }

  /**
   * Down semantics (jump): leave browsing in one press.
   * Returns draft text to restore, or null when caller should clear the prompt.
   */
  takeDraft(): string | null {
    const wasBrowsing = this.index !== -1;
    this.index = -1;
    if (!wasBrowsing) return null;
    return this.draft;
  }

  isBrowsing(): boolean {
    return this.index !== -1;
  }

  resetIndex(): void {
    this.index = -1;
  }

  reset(): void {
    this.entries = [];
    this.index = -1;
    this.draft = null;
  }

  toJSON(): string[] {
    return [...this.entries];
  }

  loadEntries(entries: string[]): void {
    this.entries = entries.slice(-MAX_ENTRIES);
    this.index = -1;
    this.draft = null;
  }

  /** Test helper */
  size(): number {
    return this.entries.length;
  }

  /** Test helper */
  getDraft(): string | null {
    return this.draft;
  }
}
