/**
 * This file provides isomorphic storage solutions for the MTE Relay client.
 * It defines a standard interface and offers default implementations for
 * in-memory and browser localStorage, allowing the client to run in various
 * JavaScript environments.
 */

import type { MteRelayStorage } from "./types";

/**
 * A default in-memory storage implementation for server-side or environments
 * without persistent storage.
 */
export class MemoryStorage implements MteRelayStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/**
 * A wrapper for browser's localStorage to be used as persistent storage.
 */
export class LocalStorageWrapper implements MteRelayStorage {
  getItem(key: string): string | null {
    return localStorage.getItem(key);
  }
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  }
  removeItem(key: string): void {
    localStorage.removeItem(key);
  }
}
