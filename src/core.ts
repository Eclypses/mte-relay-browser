/**
 * This file contains the core orchestration logic for the MTE Relay client.
 * The `sendMteRequest` function acts as the central controller, managing the
 * entire lifecycle of an MTE-protected request, including validation, pairing,
 * encoding, decoding, and error handling.
 */

import {
  deleteAllPairsFromOrigin,
  deleteCacheItem,
  deleteClientId,
  deletePairIdFromQueue,
  getCacheItem,
  getCacheKey,
  getClientId,
  getNextPairIdFromQueue,
  getOriginStatus,
  setCacheItem,
  setClientId,
  setOriginStatus,
} from "./cache";
import { decodeResponse, encodeRequest } from "./codec";
import { config, _fetch } from "./config";
import { MteRelayError } from "./errors";
import { pairWithOrigin, validateRemoteIsMteRelay } from "./pairing";
import { MTE_RELAY_HEADER } from "./constants";
import { parseMteRelayHeader } from "./utils";
import type { MteRequestOptions } from "./types";

/**
 * Orchestrates the MTE fetch process, including pairing, encoding, and decoding.
 * @param url The request URL or Request object.
 * @param options Standard fetch options.
 * @param mteOptions MTE-specific options.
 * @param isRetry A flag to prevent infinite retry loops.
 * @returns A Promise that resolves to a decoded Response.
 */
export async function sendMteRequest(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: Partial<MteRequestOptions>,
  isRetry = false
): Promise<Response> {
  let pairId = "";
  const _request = url instanceof Request ? url : new Request(url, options);
  const requestOrigin = new URL(_request.url).origin;

  try {
    await ensureOriginIsReady(requestOrigin);

    const _mteOptions: MteRequestOptions = {
      encodeUrl: mteOptions?.encodeUrl ?? config.encodeUrls,
      encodeHeaders: mteOptions?.encodeHeaders ?? config.encodeHeaders,
      encodeType: mteOptions?.encodeType || config.encodeType,
      useStreaming: mteOptions?.useStreaming ?? true,
      pathPrefix: mteOptions?.pathPrefix ?? config.pathPrefix,
    };

    const clientId = await getClientId(requestOrigin);
    if (!clientId) {
      throw new Error("Origin is missing ClientId");
    }

    pairId = getNextPairIdFromQueue(requestOrigin);

    const encodedRequest = await encodeRequest(_request, {
      pairId,
      type: _mteOptions.encodeType,
      origin: requestOrigin,
      clientId: clientId,
      encodeUrl: _mteOptions.encodeUrl,
      encodeHeaders: _mteOptions.encodeHeaders,
      useStreaming: _mteOptions.useStreaming,
      pathPrefix: _mteOptions.pathPrefix,
    });

    const response = await _fetch(encodedRequest);

    if (!response.ok && MteRelayError.isMteErrorStatus(response.status)) {
      const msg = MteRelayError.getStatusErrorMessages(response.status);
      if (msg) throw new MteRelayError(msg, { status: response.status });
    }
    if (response.redirected) {
      return response;
    }

    const mteRelayHeader = response.headers.get(MTE_RELAY_HEADER);
    if (!mteRelayHeader) {
      throw new Error("Origin is not an MTE Relay server.");
    }

    const parsedRelayHeaders = parseMteRelayHeader(mteRelayHeader);
    await setClientId(requestOrigin, parsedRelayHeaders.clientId);

    return await decodeResponse(response, {
      decoderId: `decoder.${requestOrigin}.${parsedRelayHeaders.pairId}`,
    });
  } catch (error) {
    if (error instanceof MteRelayError) {
      if (error.status === 566 || error.status === 560) {
        setOriginStatus(requestOrigin, "pending");
        await deleteClientId(requestOrigin);
        deleteAllPairsFromOrigin(requestOrigin);
        if (isRetry) {
          throw new Error("Origin is not an MTE Relay server after retry.");
        }
        return await sendMteRequest(url, options, mteOptions, true);
      }

      if (!isRetry) {
        deletePairIdFromQueue(requestOrigin, pairId);
        await pairWithOrigin(requestOrigin, 1);
        return await sendMteRequest(url, options, mteOptions, true);
      }
    }

    if (error instanceof Error) throw error;
    throw Error("An unknown error occurred.", { cause: error });
  }
}

/**
 * Ensures the client is validated and paired with the origin server.
 * @param {string} origin The origin URL to prepare.
 */
async function ensureOriginIsReady(origin: string): Promise<void> {
  const initPromiseKey = getCacheKey("INIT_PROMISE", origin);
  const existingPromise = getCacheItem<Promise<void>>(initPromiseKey);
  if (existingPromise) {
    return await existingPromise;
  }

  const originStatus = getOriginStatus(origin);

  if (originStatus === "paired") {
    return;
  }

  if (originStatus === "invalid") {
    throw new Error("Origin is not a valid MTE Relay server.");
  }

  if (originStatus === "validate" || originStatus === "pending") {
    const newPromise = (async () => {
      try {
        await validateRemoteIsMteRelay(origin);
        await pairWithOrigin(origin);
        setOriginStatus(origin, "paired");
      } catch (error) {
        setOriginStatus(origin, "invalid");
        deleteCacheItem(initPromiseKey);
        throw error;
      }
    })();

    setCacheItem(initPromiseKey, newPromise);
    return await newPromise;
  }
}
