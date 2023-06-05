import {
  instantiateDecoder,
  instantiateEncoder,
  instantiateMteWasm as initWasm,
  mkeDecode,
  mkeEncode,
} from "./mte";
import {
  SERVER_ID_HEADER,
  CLIENT_ID_HEADER,
  MTE_ENCODED_HEADERS_HEADER,
  SESSION_ID_HEADER,
} from "./constants";
import {
  getRegisteredOrigin,
  MteRelayRecord,
  registerOrigin,
  unregisterOrigin,
} from "./origin-cache";
import { generateRandomId } from "./utils/generate-id";
import { getEcdh } from "./utils/ecdh";
import cloneDeep from "lodash.clonedeep";
import { MteRelayError } from "./mte/errors";
import { getValidOrigin } from "./utils/get-valid-origin";
import { setCookie, getCookieValue } from "./utils/cookies";

let SESSION_ID: string = "";
let CLIENT_ID: string | null;

// export init function
export async function instantiateMteWasm(options: {
  licenseKey: string;
  licenseCompany: string;
}) {
  await initWasm({
    licenseKey: options.licenseKey,
    companyName: options.licenseCompany,
  });
  const clientId = getCookieValue(CLIENT_ID_HEADER);
  if (clientId) {
    CLIENT_ID = clientId;
  }
  setNewSessionId();
}

type MteRequestOptions = {
  encodeHeaders: boolean | string[];
};

const defaultMteRequestOptions: MteRequestOptions = {
  encodeHeaders: true,
};

// send encoded request
// if it throws an MTE error, try again 1 time
export async function mteFetch(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: MteRequestOptions
) {
  try {
    return await sendMteRequest(url, options, mteOptions);
  } catch (error) {
    if (error instanceof MteRelayError) {
      const urlOrigin = getValidOrigin(url);
      unregisterOrigin(urlOrigin);
      setNewSessionId();
      return await sendMteRequest(url, options, mteOptions);
    }
    let message = "An unknown error occurred.";
    if (error instanceof Error) {
      message = error.message;
    }
    throw Error(message);
  }
}

// export network request function
async function sendMteRequest(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: MteRequestOptions
): Promise<Response> {
  // copy the session ID to use for the duration of this request
  let _SESSION_ID = SESSION_ID;
  let urlOrigin = "";
  const _options = options || {};
  const _mteOptions = Object.assign(defaultMteRequestOptions, mteOptions);
  if (url instanceof Request && typeof url !== "string") {
    throw new Error("Request not support yet. Use string url for now.");
  }
  let mteRelayOrigin = getRegisteredOrigin(url);

  /**
   * If origin is not yet registered,
   * - check if origin is an MTE Relay server
   * - register origin
   * - pair with origin
   */
  urlOrigin = getValidOrigin(url);
  if (!mteRelayOrigin) {
    const mteRelayServerId = await requestServerTranslatorId(
      urlOrigin,
      _SESSION_ID
    );
    mteRelayOrigin = registerOrigin({
      origin: urlOrigin,
      mteId: mteRelayServerId,
    });
    await pairWithOrigin(urlOrigin, _SESSION_ID);
  }

  // no-store response
  _options.cache = "no-store";

  // add headers if they do not exist
  _options.headers = new Headers(_options.headers || {});

  /**
   * MTE Encode Headers and Body (if they exist)
   */
  const encodedOptions = await encodeRequest(
    _options,
    mteRelayOrigin,
    _mteOptions,
    _SESSION_ID
  );

  /**
   * Send the request
   */
  let response = await fetch(url, encodedOptions);

  // handle a bad response
  if (!response.ok) {
    if (MteRelayError.isMteErrorStatus(response.status)) {
      const msg = MteRelayError.getStatusErrorMessages(response.status);
      if (msg) {
        throw new MteRelayError(msg);
      }
    }
    return response;
  }

  // get server ID
  const serverId = response.headers.get(SERVER_ID_HEADER);
  if (!serverId) {
    throw new Error(`Response is missing header: ${SERVER_ID_HEADER}`);
  }

  // save client ID
  CLIENT_ID = response.headers.get(CLIENT_ID_HEADER);
  if (!CLIENT_ID) {
    throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
  }
  setCookie(CLIENT_ID_HEADER, CLIENT_ID);

  // get session ID from this request/response
  const responseSessionId = response.headers.get(SESSION_ID_HEADER);
  if (!responseSessionId) {
    throw new Error(`Response is missing header: ${SESSION_ID_HEADER}`);
  }

  // decode encoded headers
  const responseEncodedHeaders = response.headers.get(
    MTE_ENCODED_HEADERS_HEADER
  )!;
  const responseDecodedHeadersJson = await mkeDecode(responseEncodedHeaders, {
    stateId: `decoder.${serverId}.${responseSessionId}`,
    output: "str",
  });
  const responseDecodedHeaders = JSON.parse(
    responseDecodedHeadersJson as string
  );

  // get response as blob
  const blob = await response.blob();

  // if blob is empty, return early
  if (blob.size < 1) {
    // return decoded response
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...response.headers,
        ...responseDecodedHeaders,
      },
    });
  }

  const buffer = await blob.arrayBuffer();
  const u8 = new Uint8Array(buffer);

  let contentType = "application/json";
  const _contentType = responseDecodedHeaders["content-type"];
  if (_contentType) {
    contentType = _contentType;
  }
  const _output = contentTypeIsText(contentType) ? "str" : "Uint8Array";

  const decodedBody = await mkeDecode(u8, {
    stateId: `decoder.${serverId}.${responseSessionId}`,
    // @ts-ignore
    output: _output,
  });

  // return decoded response
  return new Response(decodedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...response.headers,
      ...responseDecodedHeaders,
    },
  });
}

// updates the session ID
// which can then be used to create a new encoder/decoder
function setNewSessionId() {
  SESSION_ID = generateRandomId();
}

// determine if encoded content should be decoded to text or to UInt8Array
function contentTypeIsText(contentType: string) {
  const textsTypes = ["text", "json", "xml", "javascript"];
  return textsTypes.some((i) => contentType.toLowerCase().includes(i));
}

/**
 * Make a HEAD request to check for x-mte-id response header,
 * If it exists, we assume the origin is an mte translator.
 */
async function requestServerTranslatorId(origin: string, sessionId: string) {
  const _headers: Record<string, string> = {
    [SESSION_ID_HEADER]: sessionId,
  };
  if (CLIENT_ID) {
    _headers[CLIENT_ID_HEADER] = CLIENT_ID;
  }
  const response = await fetch(origin + "/api/mte-relay", {
    method: "HEAD",
    credentials: "include",
    headers: _headers,
  });
  if (!response.ok) {
    throw new Error("Origin is not an MTE Relay origin.");
  }
  const serverId = response.headers.get(SERVER_ID_HEADER);
  if (!serverId) {
    throw new Error(`Response is missing header: ${SERVER_ID_HEADER}`);
  }
  CLIENT_ID = response.headers.get(CLIENT_ID_HEADER);
  if (!CLIENT_ID) {
    throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
  }
  setCookie(CLIENT_ID_HEADER, CLIENT_ID);
  return serverId;
}

/**
 * Pair with Server MTE Translator
 */
async function pairWithOrigin(origin: string, sessionId: string) {
  const encoderPersonalizationStr = generateRandomId();
  const encoderEcdh = await getEcdh();
  const decoderPersonalizationStr = generateRandomId();
  const decoderEcdh = await getEcdh();

  const _headers: Record<string, string> = {
    "Content-Type": "application/json",
    [SESSION_ID_HEADER]: sessionId,
  };
  if (CLIENT_ID) {
    _headers[CLIENT_ID_HEADER] = CLIENT_ID;
  }

  const response = await fetch(`${origin}/api/mte-pair`, {
    method: "POST",
    headers: _headers,
    credentials: "include",
    body: JSON.stringify({
      encoderPersonalizationStr,
      encoderPublicKey: encoderEcdh.publicKey,
      decoderPersonalizationStr,
      decoderPublicKey: decoderEcdh.publicKey,
    }),
  });
  if (!response.ok) {
    throw new Error("Failed to pair with server MTE Translator.");
  }
  const serverId = response.headers.get(SERVER_ID_HEADER);
  if (!serverId) {
    throw new Error(`Response is missing header: ${SERVER_ID_HEADER}`);
  }
  CLIENT_ID = response.headers.get(CLIENT_ID_HEADER);
  if (!CLIENT_ID) {
    throw new Error(`Response is missing header: ${CLIENT_ID_HEADER}`);
  }
  setCookie(CLIENT_ID_HEADER, CLIENT_ID);

  // convert response to json
  const pairResponseData = await response.json();

  // create entropy
  const encoderEntropy = await encoderEcdh.computeSharedSecret(
    pairResponseData.decoderPublicKey
  );
  const decoderEntropy = await decoderEcdh.computeSharedSecret(
    pairResponseData.encoderPublicKey
  );

  // create encoder/decoder
  await instantiateEncoder({
    entropy: encoderEntropy,
    nonce: pairResponseData.decoderNonce,
    personalization: encoderPersonalizationStr,
    id: `encoder.${serverId}.${sessionId}`,
  });

  await instantiateDecoder({
    entropy: decoderEntropy,
    nonce: pairResponseData.encoderNonce,
    personalization: decoderPersonalizationStr,
    id: `decoder.${serverId}.${sessionId}`,
  });
}

/**
 * encode headers and body of request
 */
async function encodeRequest(
  options: RequestInit,
  originRecord: MteRelayRecord,
  mteOptions: MteRequestOptions,
  sessionId: string
) {
  // clone original into new copy and modify copy
  const _options = cloneDeep(options);

  // create the encoder id once, use it where needed
  const encoderId = `encoder.${originRecord.mteId}.${sessionId}`;

  // encode the content-type header (if it exists)
  const headers = new Headers(_options.headers);

  // encode headers
  const _headers: Headers = await (async () => {
    const headersToEncode: Record<string, string> = {};

    // original content-type ALWAYS must be encoded and preserved (because we have to change content-type to application/octet-stream)
    const contentType = headers.get("content-type");
    if (contentType) {
      headersToEncode["content-type"] = contentType;
    }

    // if boolean, encode all or nothing
    if (typeof mteOptions.encodeHeaders === "boolean") {
      if (mteOptions.encodeHeaders === true) {
        for (const [name, value] of headers.entries()) {
          headersToEncode[name] = value;
          headers.delete(name);
        }
      }
      if (isObjectEmpty(headersToEncode)) {
        return headers;
      }
      const headersJSON = JSON.stringify(headersToEncode);
      const encodedHeader = await mkeEncode(headersJSON, {
        stateId: encoderId,
        output: "B64",
      });
      headers.set(MTE_ENCODED_HEADERS_HEADER, encodedHeader as string);
      return headers;
    }

    // if array, encode just those headers
    if (Array.isArray(mteOptions.encodeHeaders)) {
      const allStrings = mteOptions.encodeHeaders.every(
        (i) => typeof i === "string"
      );
      if (!allStrings) {
        throw Error(
          `Expected an array of strings for mteOptions.encodeHeaders, but received ${mteOptions.encodeHeaders}.`
        );
      }
      // encode each header (except content-type header, which is ALWAYS encoded)
      const sansContentType = mteOptions.encodeHeaders.filter(
        (i) => i !== "content-type"
      );
      if (isObjectEmpty(sansContentType)) {
        return headers;
      }
      for (const headerName of sansContentType) {
        const headerValue = headers.get(headerName);
        if (headerValue) {
          headersToEncode[headerName] = headerValue;
          headers.delete(headerName);
        }
      }
      const headersJSON = JSON.stringify(headersToEncode);
      const encodedHeaders = await mkeEncode(headersJSON, {
        stateId: encoderId,
        output: "B64",
      });
      headers.set(MTE_ENCODED_HEADERS_HEADER, encodedHeaders as string);
      return headers;
    }
    throw Error(
      `Unexpected type for mteOptions.encodeHeaders. Expected boolean or string array, but received ${typeof mteOptions.encodeHeaders}.`
    );
  })();

  // append mte relay client and session IDs
  _headers.set(CLIENT_ID_HEADER, CLIENT_ID!);
  _headers.set(SESSION_ID_HEADER, sessionId);
  _headers.set("content-type", "application/octet-stream");

  _options.headers = _headers;

  // Determine how to encode the body (if it exists)
  if (_options.body) {
    await (async () => {
      // handle strings
      if (typeof _options.body === "string") {
        _options.body = await mkeEncode(_options.body as any, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle Uint8Arrays
      if (_options.body instanceof Uint8Array) {
        _options.body = await mkeEncode(_options.body as any, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle FormData
      if (_options.body instanceof FormData) {
        // delete content-type header, it is set by browser
        _headers.delete("content-type");

        // create new formData object
        const _encodedFormData = new FormData();

        // loop over all entries of the original formData
        const entries = _options.body.entries();
        for await (const [key, value] of entries) {
          // encode the key
          const encodedKey = await mkeEncode(key, {
            stateId: encoderId,
            output: "B64",
          });

          // handle value as a string
          if (typeof value === "string") {
            const encodedValue = await mkeEncode(value, {
              stateId: encoderId,
              output: "B64",
            });
            _encodedFormData.set(encodedKey as string, encodedValue as string);
            continue;
          }

          // handle value as a File object
          if (value instanceof File) {
            let fileName = value.name;
            if (fileName) {
              fileName = (await mkeEncode(fileName, {
                stateId: encoderId,
                output: "B64",
              })) as string;
              // URI encode the filename
              fileName = encodeURIComponent(fileName);
            }
            const buffer = await value.arrayBuffer();
            const u8 = new Uint8Array(buffer);
            const encodedValue = await mkeEncode(u8, {
              stateId: encoderId,
              output: "Uint8Array",
            });
            _encodedFormData.set(
              encodedKey as string,
              new File([encodedValue as string], fileName)
            );
            continue;
          }

          // throw error if we don't know what the value type is
          console.log(typeof value, value);
          throw new Error("Unknown value to encode.");
        }

        // set the value of the body to our newly encoded formData
        _options.body = _encodedFormData;
        return;
      }

      // handle arraybuffers
      if (_options.body instanceof ArrayBuffer) {
        _options.body = await mkeEncode(new Uint8Array(_options.body), {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle URLSearchParams
      if (_options.body instanceof URLSearchParams) {
        _options.body = await mkeEncode(_options.body.toString(), {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle DataView
      if ((_options.body as DataView).buffer instanceof ArrayBuffer) {
        const u8 = new Uint8Array((_options.body as DataView).buffer);
        _options.body = await mkeEncode(u8, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle Blob, File, etc...
      if (typeof (_options.body as Blob).arrayBuffer === "function") {
        const buffer = await (_options.body as Blob).arrayBuffer();
        const u8 = new Uint8Array(buffer);
        _options.body = await mkeEncode(u8, {
          stateId: encoderId,
          output: "Uint8Array",
        });
        return;
      }

      // handle readable stream
      if (_options.body instanceof ReadableStream) {
        throw new Error("Readable streams are not supported, yet.");
      }
    })();
  }

  return _options;
}

/**
 * Checks if an object is empty.
 * @param obj - The object to check.
 * @returns True if the object is empty, false otherwise.
 */
function isObjectEmpty(obj: object | null): boolean {
  // Check if obj is an object
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  // Check if obj has any own properties
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return false;
    }
  }

  return true;
}
