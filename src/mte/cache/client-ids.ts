const cache = new Map();

const localStorageKey = "mteRelayClientIds";

// initialize cache from localStorage
export function initializeClientIds() {
  if (!window) {
    return;
  }
  const cacheString = localStorage.getItem(localStorageKey);
  if (cacheString) {
    const parsed = JSON.parse(cacheString);
    for (const key in parsed) {
      cache.set(key, parsed[key]);
    }
  }
}

// get clientId from cache
export function getClientId(origin: string) {
  return cache.get(origin) as string | undefined;
}

// set clientId in cache
export function setClientId(serverOrigin: string, clientId: string) {
  cache.set(serverOrigin, clientId);
  localStorage.setItem(
    localStorageKey,
    JSON.stringify(Object.fromEntries(cache))
  );
}

// delete clientId
export function deleteClientId(serverOrigin: string) {
  cache.delete(serverOrigin);
  localStorage.setItem(
    localStorageKey,
    JSON.stringify(Object.fromEntries(cache))
  );
}
