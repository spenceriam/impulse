import { batch as solidBatch } from "solid-js";

type BatchFn = () => void;

class BatchSchedulerImpl {
  private static instance: BatchSchedulerImpl;
  private pendingUpdates: Map<string, BatchFn[]> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private defaultBatchWindow: number = 16;
  private globalPending: BatchFn[] = [];
  private globalTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): BatchSchedulerImpl {
    if (!BatchSchedulerImpl.instance) {
      BatchSchedulerImpl.instance = new BatchSchedulerImpl();
    }
    return BatchSchedulerImpl.instance;
  }

  schedule(key: string, fn: BatchFn, window?: number): void {
    const batchWindow = window ?? this.defaultBatchWindow;

    if (!this.pendingUpdates.has(key)) {
      this.pendingUpdates.set(key, []);
    }

    const updates = this.pendingUpdates.get(key);
    if (updates) {
      updates.push(fn);
    }

    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.flush(key);
    }, batchWindow);

    this.timers.set(key, timer);
  }

  scheduleGlobal(fn: BatchFn, window?: number): void {
    const batchWindow = window ?? this.defaultBatchWindow;
    this.globalPending.push(fn);

    if (this.globalTimer) {
      clearTimeout(this.globalTimer);
    }

    this.globalTimer = setTimeout(() => {
      this.flushGlobal();
    }, batchWindow);
  }

  flush(key: string): void {
    const updates = this.pendingUpdates.get(key);

    if (!updates || updates.length === 0) {
      return;
    }

    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }

    this.pendingUpdates.delete(key);

    solidBatch(() => {
      for (const update of updates) {
        try {
          update();
        } catch (e) {
          console.error(`Error in batched update [${key}]:`, e);
        }
      }
    });
  }

  flushAll(): void {
    for (const key of this.pendingUpdates.keys()) {
      this.flush(key);
    }

    this.flushGlobal();
  }

  flushGlobal(): void {
    if (this.globalPending.length === 0) {
      return;
    }

    if (this.globalTimer) {
      clearTimeout(this.globalTimer);
      this.globalTimer = null;
    }

    const updates = [...this.globalPending];
    this.globalPending = [];

    solidBatch(() => {
      for (const update of updates) {
        try {
          update();
        } catch (e) {
          console.error(`Error in global batched update:`, e);
        }
      }
    });
  }

  hasPendingUpdates(key: string): boolean {
    const updates = this.pendingUpdates.get(key);
    return updates !== undefined && updates.length > 0;
  }

  hasPendingGlobalUpdates(): boolean {
    return this.globalPending.length > 0;
  }

  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }

    this.pendingUpdates.delete(key);
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingUpdates.clear();

    if (this.globalTimer) {
      clearTimeout(this.globalTimer);
      this.globalTimer = null;
    }
    this.globalPending = [];
  }

  setDefaultBatchWindow(window: number): void {
    this.defaultBatchWindow = window;
  }

  getDefaultBatchWindow(): number {
    return this.defaultBatchWindow;
  }

  getStats(): {
    pendingKeys: number
    pendingGlobal: number
    activeTimers: number
  } {
    return {
      pendingKeys: this.pendingUpdates.size,
      pendingGlobal: this.globalPending.length,
      activeTimers: this.timers.size + (this.globalTimer ? 1 : 0),
    };
  }
}

export const BatchScheduler = BatchSchedulerImpl.getInstance();

export function batch(key: string, fn: BatchFn, window?: number): void {
  BatchScheduler.schedule(key, fn, window);
}

export function batchGlobal(fn: BatchFn, window?: number): void {
  BatchScheduler.scheduleGlobal(fn, window);
}

export function flushBatch(key: string): void {
  BatchScheduler.flush(key);
}

export function flushAllBatches(): void {
  BatchScheduler.flushAll();
}

export function cancelBatch(key: string): void {
  BatchScheduler.cancel(key);
}

export function cancelAllBatches(): void {
  BatchScheduler.cancelAll();
}

export async function withBatch<T>(key: string, fn: () => T, window?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      batch(key, () => {
        const result = fn();
        resolve(result);
      }, window);
    } catch (e) {
      reject(e);
    }
  });
}
