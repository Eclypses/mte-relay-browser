const cache = new Map();

export function setCacheItem(key: string, value: any): void {
  cache.set(key, value);
}

export function getCacheItem<T>(key: string): T {
  return cache.get(key);
}

export function deleteCacheItem(key: string): void {
  cache.delete(key);
}
