/**
 * This is the default solution for caching MTE State.
 * MTE State values will be saved in-memory here, unless the consumer
 * chooses to provide their own Getter and Setter methods for retrieving
 * state from their own cache solutions; Redis, Memcached, etc.
 */

// The store
const store = new Map();

// Put an Item in the store
export async function setItem(id: string, value: string) {
  store.set(id, value);
}

/**
 * Set an item in the memory cache.
 * If it is a decoder, do NOT remove it's state from cache.
 * Two or more decoders can be created with the same state at the same time. This is NOT true for encoders.
 */
export async function takeItem(id: string): Promise<string | null> {
  const item = store.get(id);
  if (!id.includes("decoder")) {
    store.delete(id);
  }
  return item;
}
