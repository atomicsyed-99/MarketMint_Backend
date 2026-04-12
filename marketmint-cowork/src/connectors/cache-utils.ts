/** Max entries per cache. Shared across connections and processor caches. */
export const MAX_CACHE_SIZE = 500;

/**
 * Shared LRU eviction helper for Map-based caches.
 * Removes the entry with the smallest `lastAccessed` timestamp.
 */
export function evictOldest<V extends { lastAccessed: number }>(
  map: Map<string, V>,
): void {
  let oldestKey = "";
  let oldestTime = Infinity;
  for (const [key, entry] of map) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldestKey = key;
    }
  }
  if (oldestKey) map.delete(oldestKey);
}
