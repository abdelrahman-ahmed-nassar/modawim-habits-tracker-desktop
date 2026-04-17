/**
 * Simple in-memory cache utility for analytics data
 */

import { Settings } from "../types/models";
import * as dataService from "../services/dataService";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class AnalyticsCache {
  private cache: Map<string, CacheEntry<any>>;
  private settings: Settings | null;
  private settingsPromise: Promise<Settings> | null;

  constructor() {
    this.cache = new Map();
    this.settings = null;
    this.settingsPromise = null;
    this.initializeSettings();
  }

  private async initializeSettings() {
    this.settingsPromise = dataService.getSettings();
    this.settings = await this.settingsPromise;
  }

  private async getSettings(): Promise<Settings> {
    if (this.settings) {
      return this.settings;
    }
    if (this.settingsPromise) {
      return await this.settingsPromise;
    }
    await this.initializeSettings();
    return this.settings!;
  }

  private async isCacheEnabled(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings?.analytics?.cacheEnabled ?? true;
  }

  private async getCacheDuration(): Promise<number> {
    const settings = await this.getSettings();
    return (settings?.analytics?.cacheDuration ?? 5) * 60 * 1000; // Convert minutes to milliseconds
  }

  private isExpired(timestamp: number, duration: number): boolean {
    return Date.now() - timestamp > duration;
  }

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param data Data to cache
   * @param ttl Time to live in milliseconds
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const timestamp = Date.now();
    const duration = ttl ?? (await this.getCacheDuration());

    this.cache.set(key, {
      data,
      timestamp,
    });
  }

  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns Cached data or null if not found or expired
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if entry has expired
    const duration = await this.getCacheDuration();
    if (this.isExpired(entry.timestamp, duration)) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Check if a key exists in the cache and is not expired
   * @param key Cache key
   * @returns Whether key exists in cache
   */
  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if entry has expired
    const duration = await this.getCacheDuration();
    if (this.isExpired(entry.timestamp, duration)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   * @param key Cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache keys matching a prefix
   * @param prefix Key prefix to match
   * @returns Array of matching keys
   */
  async getKeysByPrefix(prefix: string): Promise<string[]> {
    const duration = await this.getCacheDuration();
    const keys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (
        key.startsWith(prefix) &&
        !this.isExpired(entry.timestamp, duration)
      ) {
        keys.push(key);
      }
    }

    return keys;
  }

  /**
   * Invalidate all cache entries with keys matching a prefix
   * @param prefix Key prefix to match
   */
  async invalidateByPrefix(prefix: string): Promise<void> {
    const duration = await this.getCacheDuration();
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        const entry = this.cache.get(key);
        if (entry && this.isExpired(entry.timestamp, duration)) {
          this.cache.delete(key);
        }
      }
    }
  }

  /**
   * Get or set cache entry - returns cached value if exists, otherwise
   * computes and caches the result of the factory function
   * @param key Cache key
   * @param factory Function to produce value if not in cache
   * @returns Cached or computed value
   */
  async getOrSet<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    // If cache is disabled, always fetch fresh data
    if (!(await this.isCacheEnabled())) {
      return fetchFn();
    }

    const cached = this.cache.get(key);
    const duration = await this.getCacheDuration();

    if (cached && !this.isExpired(cached.timestamp, duration)) {
      return cached.data;
    }

    const data = await fetchFn();
    await this.set(key, data);
    return data;
  }

  // Update settings when they change
  async updateSettings(settings: Settings): Promise<void> {
    this.settings = settings;
    this.settingsPromise = Promise.resolve(settings);
    // Clear cache when settings change
    this.clear();
  }
}

// Export singleton instance
export const analyticsCache = new AnalyticsCache();
