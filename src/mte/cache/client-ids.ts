import { getCacheItem, setCacheItem, deleteCacheItem } from "./cache";

const useLocalStorage = typeof window !== "undefined" && window.localStorage;

// get clientId from cache
export function getClientId(origin: string) {
  const key = prefixKey(origin);
  let id: string | null | undefined = undefined;
  id = getCacheItem<string | undefined>(key);
  if (!id && useLocalStorage) {
    id = localStorage.getItem(key);
    if (id) {
      setCacheItem(key, id);
    }
  }
  return id;
}

// set clientId in cache
export function setClientId(origin: string, clientId: string) {
  const key = prefixKey(origin);
  setCacheItem(key, clientId);
  if (useLocalStorage) {
    localStorage.setItem(key, clientId);
  }
}

// delete clientId
export function deleteClientId(origin: string) {
  const key = prefixKey(origin);
  deleteCacheItem(key);
  if (useLocalStorage) {
    localStorage.removeItem(key);
  }
}

// prefix keys with 'clientid:'
function prefixKey(key: string) {
  return `clientid:${key}`;
}
