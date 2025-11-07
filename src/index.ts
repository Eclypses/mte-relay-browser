/**
 * This file serves as the main entry point for the MTE Relay client library.
 * It exposes the public API, including the `initMteRelayClient` function for
 * configuration and the `mteFetch` function for making MTE-protected requests.
 * It also re-exports key types and classes for external use.
 */

import { config, setFetch } from "./config";
import { sendMteRequest } from "./core";
import { initWasm } from "./mte-helpers";
import { LocalStorageWrapper, MemoryStorage } from "./storage";
import type { MteRelayClientOptions, MteRequestOptions } from "./types";

export { LocalStorageWrapper, MemoryStorage };
export type { MteRelayStorage } from "./types";

/**
 * Initializes the MTE Relay Client. Must be called before `mteFetch`.
 * @param {MteRelayClientOptions} options Configuration options for the client.
 */
export async function initMteRelayClient(options: MteRelayClientOptions) {
  config.numberOfPairs = options.numberOfPairs ?? config.numberOfPairs;
  config.encodeType = options.encodeType ?? config.encodeType;
  config.encodeUrls = options.encodeUrls ?? config.encodeUrls;
  config.encodeHeaders = options.encodeHeaders ?? config.encodeHeaders;
  config.pathPrefix = options.pathPrefix ?? config.pathPrefix;
  config.mtePoolSize = options.mtePoolSize ?? config.mtePoolSize;
  config.mkePoolSize = options.mkePoolSize ?? config.mkePoolSize;
  config.customFetch = options.fetch;

  if (options.storage) {
    config.persistentStorage = options.storage;
  } else if (typeof window !== "undefined" && window.localStorage) {
    config.persistentStorage = new LocalStorageWrapper();
  } else {
    config.persistentStorage = new MemoryStorage();
  }

  const _fetch = config.customFetch || fetch;
  if (!_fetch) {
    throw new Error(
      "Fetch API is not available. Please provide a fetch implementation."
    );
  }
  setFetch(_fetch);

  await initWasm({
    licenseKey: options.licenseKey,
    companyName: options.licenseCompany,
  });
}

/**
 * Sends an MTE-encoded request using a `fetch`-like interface.
 * @param {RequestInfo} url The request URL or Request object.
 * @param {RequestInit} [options] Standard fetch options.
 * @param {Partial<MteRequestOptions>} [mteOptions] MTE-specific options.
 * @returns {Promise<Response>} A Promise resolving to the decoded Response.
 */
export async function mteFetch(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: Partial<MteRequestOptions>
): Promise<Response> {
  return await sendMteRequest(url, options, mteOptions);
}
