const cache = new Map();

// save an encoder/decoder state in cache
export function setEncDecState(id: string, state: string): void {
  cache.set(id, state);
}

// get an encoder/decoder state from cache, if it exists
export function getEncDecState(id: string) {
  return cache.get(id) as string | undefined;
}
