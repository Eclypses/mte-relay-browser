import { getCacheItem, setCacheItem } from "./cache";

// add pairId to origin pairId queue
export function addPairIdToQueue(origin: string, pairId: string) {
  const key = prefixKey(origin);
  const queue = getCacheItem<string[]>(key) || [];
  queue.push(pairId);
  setCacheItem(key, queue);
}

// get next pairId from queue
export function getNextPairIdFromQueue(origin: string) {
  const key = prefixKey(origin);
  const queue = getCacheItem<string[]>(key);
  if (!queue) {
    throw new Error(`No queue found for origin ${origin}.`);
  }
  const id = queue.shift();
  if (!id) {
    throw Error("No ID in queue.");
  }
  queue.push(id);
  setCacheItem(key, queue);
  return id;
}

// delete pairId from queue
export function deletePairIdFromQueue(origin: string, pairId: string) {
  const key = prefixKey(origin);
  const queue = getCacheItem<string[]>(key);
  if (!queue) {
    throw new Error(`No queue found for origin ${origin}.`);
  }
  const index = queue.indexOf(pairId);
  if (index === -1) {
    throw new Error(`No pairId found for origin ${origin}.`);
  }
  queue.splice(index, 1);
  setCacheItem(key, queue);
}

function prefixKey(key: string) {
  return `pairids:${key}`;
}
