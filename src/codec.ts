/**
 * This file handles the core logic for encoding outgoing requests and decoding
 * incoming responses. It orchestrates the encryption/decryption of URLs,
 * headers, and bodies.
 */

import { MTE_ENCODED_HEADERS_HEADER, MTE_RELAY_HEADER } from "./constants";
import { getEncDecState, setEncDecState } from "./cache";
import { _fetch } from "./config";
import { MteRelayError } from "./errors";
import { getMteState, restoreMteState } from "./mte-state";
import { getPoolItem, returnPoolItem } from "./mte-helpers";
import {
  drbgReseedCheck,
  formatMteRelayHeader,
  parseMteRelayHeader,
  validateStatusIsSuccess,
} from "./utils";
import { MteMkeDec } from "mte";

/**
 * Encodes a Request object's URL, headers, and body.
 * @param request The original Request object.
 * @param options Configuration for the encoding process.
 * @returns A new, MTE-encoded Request object.
 */
export async function encodeRequest(
  request: Request,
  options: {
    clientId: string;
    origin: string;
    pairId: string;
    type: "MTE" | "MKE";
    encodeUrl: boolean;
    encodeHeaders: boolean | string[];
    useStreaming: boolean;
    pathPrefix: string;
  }
): Promise<Request> {
  const url = new URL(request.url);
  const newRequestHeaders = new Headers(request.headers);

  const encoderId = `encoder.${options.origin}.${options.pairId}`;
  const currentState = getEncDecState(encoderId);
  if (!currentState) {
    throw new MteRelayError("State not found.", { stateId: encoderId });
  }
  const encoder = getPoolItem(options.type, "encoder");
  restoreMteState(encoder, currentState);

  let newRequestUrl = request.url;
  if (options.encodeUrl) {
    const route = url.pathname.slice(1) + url.search;
    const result = encoder.encodeStrB64(route);
    validateStatusIsSuccess(result.status, encoder);
    const uriEncoded = encodeURIComponent(result.str!);
    newRequestUrl = `${url.origin}${options.pathPrefix}/${uriEncoded}`;
  }

  const headersToEncode: Record<string, string> = {};
  if (options.encodeHeaders) {
    const headers = Array.isArray(options.encodeHeaders)
      ? options.encodeHeaders
      : Array.from(request.headers.keys());
    for (const header of headers) {
      const value = request.headers.get(header);
      if (value) {
        headersToEncode[header] = value;
        newRequestHeaders.delete(header);
      }
    }
  }
  const ct = request.headers.get("content-type");
  if (ct) {
    headersToEncode["content-type"] = ct;
  }
  const shouldEncodeHeaders = Object.keys(headersToEncode).length > 0;
  if (shouldEncodeHeaders) {
    const result = encoder.encodeStrB64(JSON.stringify(headersToEncode));
    validateStatusIsSuccess(result.status, encoder);
    newRequestHeaders.set(MTE_ENCODED_HEADERS_HEADER, result.str!);
  }

  let newRequestBody: BodyInit | null = null;
  const bodyIsPresent =
    request.method !== "GET" && request.method !== "HEAD" && request.body;
  let bodyIsEncoded = false;

  if (bodyIsPresent) {
    bodyIsEncoded = true;
    const bodyBytes = new Uint8Array(await request.arrayBuffer());
    if (bodyBytes.byteLength > 0) {
      const result = encoder.encode(bodyBytes);
      validateStatusIsSuccess(result.status, encoder);
      // @ts-ignore - It's a byte array, it's fine
      newRequestBody = result.arr!;
    }
    setEncDecState(encoderId, getMteState(encoder));
    returnPoolItem(encoder);
  } else {
    setEncDecState(encoderId, getMteState(encoder));
    returnPoolItem(encoder);
  }

  newRequestHeaders.set(
    MTE_RELAY_HEADER,
    formatMteRelayHeader({
      type: options.type,
      urlIsEncoded: options.encodeUrl,
      headersAreEncoded: shouldEncodeHeaders,
      bodyIsEncoded,
      clientId: options.clientId,
      pairId: options.pairId,
      useStreaming: options.useStreaming,
    })
  );
  newRequestHeaders.set("content-type", "application/octet-stream");

  const newRequestOptions: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: newRequestHeaders,
    body: newRequestBody,
    cache: "no-cache",
    credentials: request.credentials,
  };

  if (bodyIsPresent && options.useStreaming) {
    newRequestOptions.duplex = "half";
  }

  return new Request(newRequestUrl, newRequestOptions);
}

/**
 * Decodes an MTE-encoded Response object's headers and body.
 * @param response The MTE-encoded Response object.
 * @param options Configuration for the decoding process.
 * @returns A new, decoded Response object.
 */
export async function decodeResponse(
  response: Response,
  options: { decoderId: string }
): Promise<Response> {
  const x = response.headers.get(MTE_RELAY_HEADER);
  if (!x) {
    throw new MteRelayError("Missing required header", {
      "missing-header": MTE_RELAY_HEADER,
    });
  }
  const relayOptions = parseMteRelayHeader(x);
  const newHeaders = new Headers(response.headers);

  const decoderId = options.decoderId;
  const currentState = getEncDecState(decoderId);
  if (!currentState) {
    throw new MteRelayError("State not found.", { stateId: decoderId });
  }
  const decoder = getPoolItem(relayOptions.type, "decoder");
  restoreMteState(decoder, currentState);
  drbgReseedCheck(decoder);

  if (relayOptions.headersAreEncoded) {
    const header = response.headers.get(MTE_ENCODED_HEADERS_HEADER);
    if (header) {
      const result = decoder.decodeStrB64(header);
      validateStatusIsSuccess(result.status, decoder);
      const headers: Record<string, string> = JSON.parse(result.str!);
      for (const [key, value] of Object.entries(headers)) {
        newHeaders.set(key, value);
      }
      newHeaders.delete(MTE_ENCODED_HEADERS_HEADER);
    }
  }

  let newResponseBody: BodyInit | undefined = undefined;
  const bodyIsPresent = relayOptions.bodyIsEncoded && response.body;

  if (bodyIsPresent) {
    // MTE encoding, handle all at once
    if (relayOptions.type === "MTE") {
      const bodyBytes = new Uint8Array(await response.arrayBuffer());
      if (bodyBytes.byteLength > 0) {
        const result = decoder.decode(bodyBytes);
        validateStatusIsSuccess(result.status, decoder);
        // @ts-ignore - It's a byte array, it's fine
        newResponseBody = result.arr!;
      }
      setEncDecState(decoderId, getMteState(decoder));
      returnPoolItem(decoder);
    } else {
      // MKE encoding, handle streaming
      (decoder as MteMkeDec).startDecrypt();
      const reader = response.body!.getReader();
      const stream = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            const result = (decoder as MteMkeDec).finishDecrypt();
            validateStatusIsSuccess(result.status, decoder);
            if (result.arr && result.arr!.length > 0) {
              controller.enqueue(result.arr!);
            }
            setEncDecState(decoderId, getMteState(decoder));
            returnPoolItem(decoder);
            controller.close();
            return;
          }
          const result = (decoder as MteMkeDec).decryptChunk(value);
          return controller.enqueue(result);
        },
      });
      newResponseBody = stream;
    }
  } else {
    setEncDecState(decoderId, getMteState(decoder));
    returnPoolItem(decoder);
  }

  return new Response(newResponseBody, {
    headers: newHeaders,
    status: response.status,
    statusText: response.statusText,
  });
}
