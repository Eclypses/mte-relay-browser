/**
 * This file manages the global configuration state for the MTE Relay client.
 * It holds default settings, references to the MTE WASM instance, and other
 * shared state that is initialized once and used throughout the library's
 * lifecycle.
 */

import { MteWasm } from "mte";
import type { MteRelayStorage } from "./types";

export const config = {
  numberOfPairs: 5,
  encodeType: "MKE" as "MTE" | "MKE",
  encodeUrls: true,
  encodeHeaders: true as boolean | string[],
  pathPrefix: "",
  mtePoolSize: 2,
  mkePoolSize: 5,
  persistentStorage: undefined as MteRelayStorage | undefined,
  customFetch: undefined as typeof fetch | undefined,
};

export let mteWasm: MteWasm;
export let finishEncryptBytes = 0;
export let isTrial = false;
export let _fetch: typeof fetch;

/**
 * Sets the global MTE WASM instance.
 * @param {MteWasm} wasmInstance The initialized MTE WASM instance.
 */
export function setMteWasm(wasmInstance: MteWasm) {
  mteWasm = wasmInstance;
}

/**
 * Sets the number of bytes required for MKE finishEncrypt operation.
 * @param {number} bytes The number of bytes.
 */
export function setFinishEncryptBytes(bytes: number) {
  finishEncryptBytes = bytes;
}

/**
 * Sets the flag indicating if the MTE library is a trial version.
 * @param {boolean} trialStatus The trial status.
 */
export function setIsTrial(trialStatus: boolean) {
  isTrial = trialStatus;
}

/**
 * Sets the fetch implementation to be used by the client.
 * @param {typeof fetch} fetchFn The fetch function.
 */
export function setFetch(fetchFn: typeof fetch) {
  _fetch = fetchFn;
}
