import { getCacheItem, setCacheItem } from "./cache";

// save an encoder/decoder state in cache
export function setEncDecState(id: string, state: string): void {
  setCacheItem(prefixKey(id), state);
}

// get an encoder/decoder state from cache, if it exists
export function getEncDecState(id: string) {
  return getCacheItem<string>(prefixKey(id));
}

function prefixKey(key: string) {
  return `state:${key}`;
}
