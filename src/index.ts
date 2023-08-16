import {
  instantiateDecoder,
  instantiateEncoder,
  instantiateMteWasm as initWasm,
  mkeDecode,
  mkeEncode,
  getNextPairIdFromQueue,
  setEncoderDecoderPoolSize,
  deleteIdFromQueue,
} from "./mte";
import {
  SERVER_ID_HEADER,
  CLIENT_ID_HEADER,
  MTE_ENCODED_HEADERS_HEADER,
  PAIR_ID_HEADER,
} from "./constants";
import { setServerStatus, validateServer } from "./origin-cache";
import { generateRandomId } from "./utils/generate-id";
import { getEcdh } from "./utils/ecdh";
import cloneDeep from "lodash.clonedeep";
import { MteRelayError } from "./mte/errors";
import { setCookie, getCookieValue } from "./utils/cookies";

let CLIENT_ID: string | null;
let NUMBER_OF_PAIRS = 5;

/**
 * Instantiates the MTE WebAssembly module with the given options.
 *
 * @param {string} options.licenseKey - The license key for the MTE module.
 * @param {string} options.licenseCompany - The name of the licensing company.
 * @param {number} [options.numberEncoderDecoderPairs] - Indicates how many encoder/decoder pairs to create with MTE Relay Servers. Defaults to 5.
 * @param {number} [options.encoderDecoderPoolSize] - Indicates how many encoder/decoder objects to hold in memory at a time. Defaults to 5.
 * @returns {Promise<void>} A promise that resolves after the MTE module is initialized.
 */
export async function instantiateMteWasm(options: {
  licenseKey: string;
  licenseCompany: string;
  numberEncoderDecoderPairs?: number;
  encoderDecoderPoolSize?: number;
}) {
  if (options.numberEncoderDecoderPairs) {
    NUMBER_OF_PAIRS = options.numberEncoderDecoderPairs;
  }
  if (options.encoderDecoderPoolSize) {
    setEncoderDecoderPoolSize(options.encoderDecoderPoolSize);
  }
  await initWasm({
    licenseKey: options.licenseKey,
    companyName: options.licenseCompany,
  });
  const clientId = getCookieValue(CLIENT_ID_HEADER);
  if (clientId) {
    CLIENT_ID = clientId;
  }
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
  return await sendMteRequest(url, options, mteOptions);
}

// export network request function
async function sendMteRequest(
  url: RequestInfo,
  options?: RequestInit,
  mteOptions?: MteRequestOptions,
  isSecondAttempt?: boolean
): Promise<Response> {
  let pairId = "";
  let originId = "";
  let serverOrigin = "";
  try {
    // copy the session ID to use for the duration of this request
    const _options = options || {};
    const _mteOptions = Object.assign(defaultMteRequestOptions, mteOptions);
    if (url instanceof Request && typeof url !== "string") {
      throw new Error("Request not support yet. Use string url for now.");
    }

    let serverRecord = validateServer(url);
    serverOrigin = serverRecord.origin;

    // if it's pending, recheck every (100 * i)ms
    if (serverRecord.status === "pending") {
      for (let i = 0; i < 20; ++i) {
        await sleep((1 + i) * 100);
        serverRecord = validateServer(url);
        if (serverRecord.status === "paired") {
          break;
        }
        if (serverRecord.status === "invalid") {
          throw new Error("Origin is not an MTE Relay server.");
        }
      }
      if (serverRecord.status !== "paired") {
        throw new Error("Origin is not an MTE Relay server.");
      }
    }
    if (serverRecord.status === "invalid") {
      throw new Error("Origin is not an MTE Relay server.");
    }
    if (serverRecord.status === "validate") {
      const mteRelayServerId = await requestServerId(serverRecord.origin).catch(
        () => {
          setServerStatus(serverRecord.origin, "invalid");
          throw new Error("Origin is not an MTE Relay server.");
        }
      );
      await pairWithOrigin(serverRecord.origin).catch(() => {
        setServerStatus(serverRecord.origin, "invalid");
        throw new Error("Origin is not an MTE Relay server.");
      });
      serverRecord = setServerStatus(
        serverRecord.origin,
        "paired",
        mteRelayServerId
      );
    }

    if (!serverRecord.serverId) {
      throw new Error("Origin is not an MTE Relay server.");
    }

    // no-store response
    _options.cache = "no-store";

    // add headers if they do not exist
    _options.headers = new Headers(_options.headers || {});

    pairId = getNextPairIdFromQueue(serverRecord.serverId);
    originId = serverRecord.serverId;

    /**
     * MTE Encode Headers and Body (if they exist)
     */
    const encodedOptions = await encodeRequest(
      _options,
      _mteOptions,
      originId,
      pairId
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
    const responsePairId = response.headers.get(PAIR_ID_HEADER);
    if (!responsePairId) {
      throw new Error(`Response is missing header: ${PAIR_ID_HEADER}`);
    }

    // decode encoded headers
    const responseEncodedHeaders = response.headers.get(
      MTE_ENCODED_HEADERS_HEADER
    )!;
    const responseDecodedHeadersJson = await mkeDecode(responseEncodedHeaders, {
      id: `decoder.${serverId}.${pairId}`,
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
      id: `decoder.${serverId}.${pairId}`,
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
  } catch (error) {
    if (error instanceof MteRelayError) {
      deleteIdFromQueue({ serverId: originId, pairId });
      pairWithOrigin(serverOrigin, 1);
      if (!isSecondAttempt) {
        return await sendMteRequest(url, options, mteOptions, true);
      }
    }
    let message = "An unknown error occurred.";
    if (error instanceof Error) {
      message = error.message;
    }
    throw Error(message);
  }
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
async function requestServerId(origin: string) {
  const _headers: Record<string, string> = {};
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
async function pairWithOrigin(origin: string, numberOfPairs?: number) {
  if (!CLIENT_ID) {
    throw new Error("Client ID is not set.");
  }

  const initValues = [];
  const ecdh = [];

  let i = 0;
  const iMax = numberOfPairs || NUMBER_OF_PAIRS;
  for (; i < iMax; ++i) {
    const pairId = generateRandomId();
    const encoderPersonalizationStr = generateRandomId();
    const encoderEcdh = await getEcdh();
    const decoderPersonalizationStr = generateRandomId();
    const decoderEcdh = await getEcdh();

    initValues.push({
      pairId,
      encoderPersonalizationStr,
      encoderPublicKey: encoderEcdh.publicKey,
      decoderPersonalizationStr,
      decoderPublicKey: decoderEcdh.publicKey,
    });

    ecdh.push({ encoderEcdh, decoderEcdh });
  }

  const _headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  _headers[CLIENT_ID_HEADER] = CLIENT_ID;

  const response = await fetch(`${origin}/api/mte-pair`, {
    method: "POST",
    headers: _headers,
    credentials: "include",
    body: JSON.stringify(initValues),
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
  const pairResponseData: {
    pairId: string;
    encoderPublicKey: string;
    encoderNonce: string;
    decoderPublicKey: string;
    decoderNonce: string;
  }[] = await response.json();

  let j = 0;
  for (; j < pairResponseData.length; ++j) {
    const pairInit = initValues[j];
    const pairResponse = pairResponseData[j];
    const _ecdh = ecdh[j];

    // create entropy
    const encoderEntropy = await _ecdh.encoderEcdh.computeSharedSecret(
      pairResponse.decoderPublicKey
    );
    const decoderEntropy = await _ecdh.decoderEcdh.computeSharedSecret(
      pairResponse.encoderPublicKey
    );

    // create encoder/decoder
    await instantiateEncoder({
      entropy: encoderEntropy,
      nonce: pairResponse.decoderNonce,
      personalization: pairInit.encoderPersonalizationStr,
      serverId: serverId,
      pairId: pairResponse.pairId,
    });

    await instantiateDecoder({
      entropy: decoderEntropy,
      nonce: pairResponse.encoderNonce,
      personalization: pairInit.decoderPersonalizationStr,
      serverId: serverId,
      pairId: pairResponse.pairId,
    });
  }
}

/**
 * encode headers and body of request
 */
async function encodeRequest(
  options: RequestInit,
  mteOptions: MteRequestOptions,
  serverId: string,
  pairId: string
) {
  // clone original into new copy and modify copy
  const _options = cloneDeep(options);

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
        id: `encoder.${serverId}.${pairId}`,
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
        id: `encoder.${serverId}.${pairId}`,
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
  _headers.set(PAIR_ID_HEADER, pairId);
  _headers.set("content-type", "application/octet-stream");

  _options.headers = _headers;

  // Determine how to encode the body (if it exists)
  if (_options.body) {
    await (async () => {
      // handle strings
      if (typeof _options.body === "string") {
        _options.body = await mkeEncode(_options.body as any, {
          id: `encoder.${serverId}.${pairId}`,
          output: "Uint8Array",
        });
        return;
      }

      // handle Uint8Arrays
      if (_options.body instanceof Uint8Array) {
        _options.body = await mkeEncode(_options.body as any, {
          id: `encoder.${serverId}.${pairId}`,
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
            id: `encoder.${serverId}.${pairId}`,
            output: "B64",
          });

          // handle value as a string
          if (typeof value === "string") {
            const encodedValue = await mkeEncode(value, {
              id: `encoder.${serverId}.${pairId}`,
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
                id: `encoder.${serverId}.${pairId}`,
                output: "B64",
              })) as string;
              // URI encode the filename
              fileName = encodeURIComponent(fileName);
            }
            const buffer = await value.arrayBuffer();
            const u8 = new Uint8Array(buffer);
            const encodedValue = await mkeEncode(u8, {
              id: `encoder.${serverId}.${pairId}`,
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
          id: `encoder.${serverId}.${pairId}`,
          output: "Uint8Array",
        });
        return;
      }

      // handle URLSearchParams
      if (_options.body instanceof URLSearchParams) {
        _options.body = await mkeEncode(_options.body.toString(), {
          id: `encoder.${serverId}.${pairId}`,
          output: "Uint8Array",
        });
        return;
      }

      // handle DataView
      if ((_options.body as DataView).buffer instanceof ArrayBuffer) {
        const u8 = new Uint8Array((_options.body as DataView).buffer);
        _options.body = await mkeEncode(u8, {
          id: `encoder.${serverId}.${pairId}`,
          output: "Uint8Array",
        });
        return;
      }

      // handle Blob, File, etc...
      if (typeof (_options.body as Blob).arrayBuffer === "function") {
        const buffer = await (_options.body as Blob).arrayBuffer();
        const u8 = new Uint8Array(buffer);
        _options.body = await mkeEncode(u8, {
          id: `encoder.${serverId}.${pairId}`,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
