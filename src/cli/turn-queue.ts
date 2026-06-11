import type { PromptSubmitPayload } from "./prompt-input.js";

export const DEFAULT_MAX_TURN_QUEUE = 20;

export interface TurnQueueEditState {
  holdDrain: boolean;
  editIndex: number;
  editOriginal: PromptSubmitPayload | null;
}

/**
 * In-memory turn queue while the agent is busy.
 * Preview rendering stays in the renderer; this class owns queue state and edits.
 */
export class TurnQueueManager {
  private queue: PromptSubmitPayload[] = [];
  private holdDrain = false;
  private editOriginal: PromptSubmitPayload | null = null;
  private editIndex = 0;

  constructor(
    private readonly maxSize: number,
    private readonly isNonempty: (payload: PromptSubmitPayload) => boolean
  ) {}

  get length(): number {
    return this.queue.length;
  }

  get isHoldDrain(): boolean {
    return this.holdDrain;
  }

  get editState(): TurnQueueEditState {
    return {
      holdDrain: this.holdDrain,
      editIndex: this.editIndex,
      editOriginal: this.editOriginal,
    };
  }

  snapshot(): PromptSubmitPayload[] {
    return [...this.queue];
  }

  at(index: number): PromptSubmitPayload | undefined {
    return this.queue[index];
  }

  enqueue(payload: PromptSubmitPayload): "ok" | "empty" | "full" {
    if (!this.isNonempty(payload)) return "empty";
    if (this.queue.length >= this.maxSize) return "full";
    this.queue.push(payload);
    return "ok";
  }

  /** Drop empty heads; returns whether anything remains. */
  pruneHead(): boolean {
    while (this.queue.length > 0 && !this.isNonempty(this.queue[0]!)) {
      this.queue.shift();
    }
    return this.queue.length > 0;
  }

  shift(): PromptSubmitPayload | undefined {
    return this.queue.shift();
  }

  clearHead(): boolean {
    if (this.queue.length === 0) return false;
    this.queue.shift();
    return true;
  }

  beginEdit(): boolean {
    if (this.queue.length === 0) return false;
    if (!this.holdDrain) {
      this.holdDrain = true;
      this.editIndex = 0;
    } else {
      this.editIndex = (this.editIndex + 1) % this.queue.length;
    }
    this.editOriginal = { ...this.queue[this.editIndex]! };
    return true;
  }

  cancelEdit(): void {
    if (!this.holdDrain) return;
    if (this.editOriginal && this.editIndex < this.queue.length) {
      this.queue[this.editIndex] = this.editOriginal;
    }
    this.editOriginal = null;
    this.holdDrain = false;
    this.editIndex = 0;
  }

  /** Remove the queued item at index (used when user clears text and presses Enter while editing). */
  deleteAt(index: number): boolean {
    if (index < 0 || index >= this.queue.length) return false;
    this.queue.splice(index, 1);
    this.editOriginal = null;
    this.holdDrain = false;
    this.editIndex = 0;
    return true;
  }

  commitEdit(payload: PromptSubmitPayload): void {
    if (!this.holdDrain) return;
    if (this.isNonempty(payload) && this.editIndex < this.queue.length) {
      this.queue[this.editIndex] = payload;
    } else if (
      this.editOriginal &&
      this.isNonempty(this.editOriginal) &&
      this.editIndex < this.queue.length
    ) {
      this.queue[this.editIndex] = this.editOriginal;
    }
    this.editOriginal = null;
    this.holdDrain = false;
    this.editIndex = 0;
  }

  /** Message currently being edited (for prompt prefill). */
  editingPayload(): PromptSubmitPayload | null {
    if (!this.holdDrain || this.editIndex >= this.queue.length) return null;
    return this.queue[this.editIndex] ?? null;
  }
}
