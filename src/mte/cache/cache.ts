const cache = new Map();

export function setCacheItem(key: string, value: any): void {
  cache.set(key, value);
  // log out all cache items
  Object.keys(cache).forEach((key) => {
    console.log(key, cache.get(key));
  });
}

export function getCacheItem<T>(key: string): T {
  // log out all cache items
  console.clear();
  cache.forEach((value, key) => {
    console.log(key, value);
  });
  return cache.get(key);
}

export function deleteCacheItem(key: string): void {
  cache.delete(key);
}
