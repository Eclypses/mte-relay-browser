/**
 * This file provides an in-memory caching layer for the MTE Relay client.
 * It manages origin statuses, client IDs, pair queues, and MTE states to
 * optimize performance and maintain session information. It also interacts
 * with the persistent storage interface for durability.
 */

import { CACHE_KEYS } from "./constants";
import { config } from "./config";
import type { OriginStatus } from "./types";

const cache = new Map<string, any>();

/**
 * Generates a standardized cache key.
 * @param {keyof typeof CACHE_KEYS} type The type of cache entry.
 * @param {string} id The unique identifier for the entry.
 * @returns {string} The generated cache key.
 */
export const getCacheKey = (type: keyof typeof CACHE_KEYS, id: string) =>
  `${CACHE_KEYS[type]}:${id}`;

/**
 * Sets a value in the in-memory cache.
 * @param {string} key The cache key.
 * @param {*} value The value to store.
 */
export function setCacheItem(key: string, value: any): void {
  cache.set(key, value);
}

/**
 * Gets a value from the in-memory cache.
 * @param {string} key The cache key.
 * @returns {T | undefined} The cached value.
 */
export function getCacheItem<T>(key: string): T | undefined {
  return cache.get(key);
}

/**
 * Deletes an item from the in-memory cache.
 * @param {string} key The cache key.
 */
export function deleteCacheItem(key: string): void {
  cache.delete(key);
}

/**
 * Gets the current status of an origin.
 * @param {string} origin The origin URL.
 * @returns {OriginStatus} The current status.
 */
export function getOriginStatus(origin: string): OriginStatus {
  const key = getCacheKey("ORIGIN_STATUS", origin);
  const record = getCacheItem<OriginStatus>(key);
  if (record) return record;
  setCacheItem(key, "validate");
  return "validate";
}

/**
 * Sets the status for a given origin.
 * @param {string} origin The origin URL.
 * @param {OriginStatus} status The new status.
 */
export function setOriginStatus(origin: string, status: OriginStatus): void {
  setCacheItem(getCacheKey("ORIGIN_STATUS", origin), status);
}

/**
 * Retrieves the client ID for a given origin, checking cache and persistent storage.
 * @param {string} origin The origin URL.
 * @returns {Promise<string | undefined>} The client ID.
 */
export async function getClientId(origin: string): Promise<string | undefined> {
  const key = getCacheKey("CLIENT_ID", origin);
  let id = getCacheItem<string>(key);
  if (!id && config.persistentStorage) {
    const storedId = await config.persistentStorage.getItem(key);
    id = storedId || undefined;
    if (id) {
      setCacheItem(key, id);
    }
  }
  return id;
}

/**
 * Sets the client ID for an origin in cache and persistent storage.
 * @param {string} origin The origin URL.
 * @param {string} clientId The client ID.
 */
export async function setClientId(
  origin: string,
  clientId: string
): Promise<void> {
  const key = getCacheKey("CLIENT_ID", origin);
  setCacheItem(key, clientId);
  if (config.persistentStorage) {
    await config.persistentStorage.setItem(key, clientId);
  }
}

/**
 * Deletes the client ID for an origin from cache and persistent storage.
 * @param {string} origin The origin URL.
 */
export async function deleteClientId(origin: string): Promise<void> {
  const key = getCacheKey("CLIENT_ID", origin);
  deleteCacheItem(key);
  if (config.persistentStorage) {
    await config.persistentStorage.removeItem(key);
  }
}

/**
 * Adds a new pair ID to an origin's queue.
 * @param {string} origin The origin URL.
 * @param {string} pairId The pair ID to add.
 */
export function addPairIdToQueue(origin: string, pairId: string): void {
  const key = getCacheKey("PAIR_QUEUE", origin);
  const queue = getCacheItem<string[]>(key) || [];
  queue.push(pairId);
  setCacheItem(key, queue);
}

/**
 * Gets the next available pair ID from an origin's queue and rotates it.
 * @param {string} origin The origin URL.
 * @returns {string} The next pair ID.
 */
export function getNextPairIdFromQueue(origin: string): string {
  const key = getCacheKey("PAIR_QUEUE", origin);
  const queue = getCacheItem<string[]>(key);
  if (!queue || queue.length === 0) {
    throw new Error(`No pair queue found for origin ${origin}.`);
  }
  const id = queue.shift()!;
  queue.push(id);
  setCacheItem(key, queue);
  return id;
}

/**
 * Removes a specific pair ID from an origin's queue.
 * @param {string} origin The origin URL.
 * @param {string} pairId The pair ID to remove.
 */
export function deletePairIdFromQueue(origin: string, pairId: string): void {
  const key = getCacheKey("PAIR_QUEUE", origin);
  const queue = getCacheItem<string[]>(key);
  if (!queue) return;
  const index = queue.indexOf(pairId);
  if (index > -1) queue.splice(index, 1);
  setCacheItem(key, queue);
}

/**
 * Clears all pair IDs for a given origin.
 * @param {string} origin The origin URL.
 */
export function deleteAllPairsFromOrigin(origin: string): void {
  setCacheItem(getCacheKey("PAIR_QUEUE", origin), []);
}

/**
 * Caches the state of an MTE encoder or decoder.
 * @param {string} id The unique identifier for the state.
 * @param {string} state The Base64 encoded state string.
 */
export function setEncDecState(id: string, state: string): void {
  setCacheItem(getCacheKey("MTE_STATE", id), state);
}

/**
 * Retrieves the cached state of an MTE encoder or decoder.
 * @param {string} id The unique identifier for the state.
 * @returns {string | undefined} The Base64 encoded state string.
 */
export function getEncDecState(id: string): string | undefined {
  return getCacheItem<string>(getCacheKey("MTE_STATE", id));
}
