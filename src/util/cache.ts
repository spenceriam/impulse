interface CacheEntry<T> {
  value: T
  timestamp: number
  ttl?: number
}

export interface CacheOptions {
  maxSize?: number
  ttl?: number
}

class CacheImpl<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTTL: number | undefined;

  constructor(options: CacheOptions = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize ?? 100;
    this.defaultTTL = options.ttl;
  }

  set(key: string, value: T, ttl?: number): void {
    const resolvedTTL = ttl !== undefined ? ttl : this.defaultTTL;
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
    };

    if (resolvedTTL !== undefined) {
      entry.ttl = resolvedTTL;
    }

    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, entry);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  getStats(): {
    size: number
    maxSize: number
    hitRate: number
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0,
    };
  }
}

export function createCache<T>(options: CacheOptions = {}): CacheImpl<T> {
  return new CacheImpl(options);
}
