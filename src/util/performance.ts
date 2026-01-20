interface PerformanceMetric {
  name: string
  startTime: number
  endTime?: number
  duration?: number
  metadata?: Record<string, unknown>
}

class PerformanceMonitorImpl {
  private static instance: PerformanceMonitorImpl;
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private currentMeasurements: Map<string, PerformanceMetric> = new Map();

  private constructor() {}

  static getInstance(): PerformanceMonitorImpl {
    if (!PerformanceMonitorImpl.instance) {
      PerformanceMonitorImpl.instance = new PerformanceMonitorImpl();
    }
    return PerformanceMonitorImpl.instance;
  }

  start(name: string, metadata?: Record<string, unknown>): void {
    const metric: PerformanceMetric = {
      name,
      startTime: performance.now(),
    };

    if (metadata !== undefined) {
      metric.metadata = metadata;
    }

    this.currentMeasurements.set(name, metric);
  }

  end(name: string): number {
    const metric = this.currentMeasurements.get(name);

    if (!metric) {
      throw new Error(`No active measurement for: ${name}`);
    }

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;

    const existing = this.metrics.get(name) ?? [];
    this.metrics.set(name, [...existing, metric]);
    this.currentMeasurements.delete(name);

    return metric.duration;
  }

  measure<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    this.start(name, metadata);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }

  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    this.start(name, metadata);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  getMetrics(name: string): PerformanceMetric[] {
    return this.metrics.get(name) ?? [];
  }

  getAverageDuration(name: string): number {
    const metrics = this.getMetrics(name);
    if (metrics.length === 0) return 0;

    const durations = metrics
      .map((m) => m.duration)
      .filter((d): d is number => d !== undefined);

    if (durations.length === 0) return 0;

    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  getMedianDuration(name: string): number {
    const metrics = this.getMetrics(name);
    if (metrics.length === 0) return 0;

    const durations = metrics
      .map((m) => m.duration)
      .filter((d): d is number => d !== undefined)
      .sort((a, b) => a - b);

    if (durations.length === 0) return 0;

    const mid = Math.floor(durations.length / 2);
    if (durations.length % 2 === 0) {
      const left = durations[mid - 1] ?? 0;
      const right = durations[mid] ?? 0;
      return (left + right) / 2;
    } else {
      return durations[mid] ?? 0;
    }
  }

  getStats(name: string): {
    count: number
    avg: number
    min: number
    max: number
    median: number
    p95: number
  } {
    const metrics = this.getMetrics(name);
    if (metrics.length === 0) {
      return { count: 0, avg: 0, min: 0, max: 0, median: 0, p95: 0 };
    }

    const durations = metrics
      .map((m) => m.duration)
      .filter((d): d is number => d !== undefined)
      .sort((a, b) => a - b);

    if (durations.length === 0) {
      return { count: 0, avg: 0, min: 0, max: 0, median: 0, p95: 0 };
    }

    const count = durations.length;
    const avg = durations.reduce((a, b) => a + b, 0) / count;
    const min = durations[0] ?? 0;
    const max = durations[count - 1] ?? 0;
    const mid = Math.floor(count / 2);
    const medianValue =
      count % 2 === 0
        ? ((durations[mid - 1] ?? 0) + (durations[mid] ?? 0)) / 2
        : (durations[mid] ?? 0);
    const p95Index = Math.floor(count * 0.95);
    const p95 = durations[p95Index] ?? 0;

    return { count, avg, min, max, median: medianValue, p95 };
  }

  clear(name?: string): void {
    if (name) {
      this.metrics.delete(name);
    } else {
      this.metrics.clear();
    }
  }

  getMemoryUsage(): NodeJS.MemoryUsage {
    if (typeof process !== "undefined" && process.memoryUsage) {
      return process.memoryUsage();
    }
    return {
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    };
  }

  getFormattedMemoryUsage(): string {
    const usage = this.getMemoryUsage();
    const format = (bytes: number) => {
      const mb = bytes / 1024 / 1024;
      return `${mb.toFixed(2)} MB`;
    };

    return [
      `RSS: ${format(usage.rss)}`,
      `Heap: ${format(usage.heapUsed)} / ${format(usage.heapTotal)}`,
      `External: ${format(usage.external)}`,
    ].join(", ");
  }
}

export const PerformanceMonitor = PerformanceMonitorImpl.getInstance();

export function measure(name: string, metadata?: Record<string, unknown>) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
      return PerformanceMonitor.measure(
        name,
        () => originalMethod.apply(this, args),
        metadata
      );
    };

    return descriptor;
  };
}
